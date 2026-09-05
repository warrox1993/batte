import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GLYPHE_STATUT,
  TIRET_ABSENT,
  formaterDate,
  formaterEuros,
  formaterJoursRestants,
  formaterMontant,
  formaterPointsDeBase,
  ouTiret,
  parserEuros,
  type Statut,
} from '@batte/core';
import {
  schemaImpactVerrouillagePeriode,
  schemaListeComparaisonLieux,
  schemaListeDepenses,
  schemaListeEcheances,
  schemaListeImmobilisations,
  schemaListeParametres,
  schemaListePeriodes,
  schemaListeVentesParCreneau,
  schemaSyntheseExercice,
  type CategorieDepenseContrat,
  type DepenseLigneContrat,
  type EcheanceLigneContrat,
  type ImmobilisationDetailContrat,
  type ImpactVerrouillagePeriodeContrat,
  type LigneAgregatCreneauContrat,
  type MethodeAmortissementContrat,
  type OrigineCoutKilometriqueContrat,
  type Parametre,
  type PeriodeLigneContrat,
  type SyntheseExerciceContrat,
} from '@batte/core';
import { BoutonDocument } from '../composants/BoutonDocument';
import { PastilleStatut } from '../composants/affichage';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { MessageErreur } from '../composants/EncartErreur';
import { ErreurApi, requeteApi } from '../lib/api';
import { aujourdHui } from '../lib/dates';

/**
 * Écran Comptabilité (Lot 10 — docs/01 module 7, docs/06 CONTRÔLE).
 *
 * Cinq blocs empilés, chacun autonome : synthèse d'exercice, échéancier
 * réglementaire, dépenses, immobilisations, verrou de période. Aucun de ces
 * cinq écrans ne fait partie des « cinq écrans qui comptent » de docs/06 — ce
 * sont des tableaux de gestion standards, denses, sans mise en scène.
 *
 * Règle d'architecture n°1 (CLAUDE.md §3) : ce composant n'effectue AUCUN
 * calcul métier. Le résultat de l'exercice, le plan d'amortissement, la part
 * déductible d'une dépense viennent tels quels de l'API. Les seules
 * fonctions locales sont des PARSERS de saisie (texte → nombre), au même
 * titre que `parserEuros` déjà utilisé ailleurs — jamais une formule.
 *
 * CLAUDE.md §7 : l'application ne remplace ni un comptable, ni un guichet
 * d'entreprise, ni l'AFSCA. La mention figure en pied de la synthèse, à
 * l'endroit précis où un chiffre pourrait être pris pour argent comptant.
 */

/* Date du jour lue à chaque appel, jamais figée à l'import : voir `aujourdHui`
   dans `lib/dates.ts`. */
/** Meme raison que `aujourdHui` : figee a l'import, l'annee courante ferait
 * cloturer janvier 2027 sous l'exercice 2026 sur un poste laisse ouvert le
 * soir du 31 decembre. */
function anneeCourante(): number {
  return Number.parseInt(aujourdHui().slice(0, 4), 10);
}

/**
 * Toutes les occurrences de ce bandeau dans cet écran signalent un ALLER-RETOUR
 * réseau qui a échoué (chargement ou écriture) — jamais une alerte métier au
 * sens du registre `depassement` (rupture de stock, DLC, seuil franchi) :
 * déléguer au registre neutre partagé évite de faire crier une panne
 * technique comme s'il s'agissait de l'un de ces cas (CLAUDE.md §4, mission
 * du 01/08/2026 sur `composants/EncartErreur.tsx`).
 */
export function BandeauErreur({ message }: { message: string }) {
  return <MessageErreur message={message} />;
}

/**
 * Message affichable d'une erreur attrapée dans un `catch`.
 *
 * Fonction PURE, extraite du corps de neuf `catch` quasi identiques de cet
 * écran (fiche 20, docs/17) : la répétition masquait qu'ils faisaient tous la
 * même chose, et une neuvième copie-collée aurait été la première occasion
 * d'en oublier une variante. `erreur instanceof ErreurApi` seul porte un
 * message français déjà pensé pour l'écran ; toute autre erreur (panne
 * réseau, exception inattendue) retombe sur un message générique — jamais sur
 * un `catch` muet (CLAUDE.md §4).
 */
export function messageErreurApi(erreur: unknown): string {
  return erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
}

/**
 * Chemin de navigation vers l'écran Économies d'achat, filtré sur un mois
 * (docs/demandes/10 : « Comptabilité doit pouvoir renvoyer directement vers
 * l'économie d'achat du mois sans re-saisie »).
 *
 * MÊME mécanisme que le pont Produits.tsx → Menus.tsx (`navigate('/menus?
 * produit=${id}')`, `Produits.tsx:1068`) : un identifiant en paramètre
 * d'URL, rien de plus, aucun état partagé inventé entre les deux écrans.
 *
 * CE QUE CE PONT NE RÉSOUT PAS ENCORE : `Economies.tsx` (hors zone
 * d'écriture de cette mission) ne lit AUJOURD'HUI aucun paramètre d'URL —
 * ni `useSearchParams`, ni lecture de `annee`/`mois` au montage ; son
 * `annee` est une valeur locale initialisée sur l'année civile courante
 * (`anneeCourante`), toujours la même quel que soit ce qui figure dans
 * l'URL. Ce lien atterrit donc bien sur le bon écran, mais celui-ci
 * retombera sur l'année EN COURS tant que cette lecture n'y est pas ajoutée
 * (voir le rapport de livraison pour la ligne exacte à y ajouter).
 */
export function cheminEconomiesDuMois(annee: number, mois: number): string {
  return `/economies?annee=${annee}&mois=${mois}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Parsing de saisie — jamais un calcul métier, seulement lire une chaîne
   (même principe que `parserEuros` de @batte/core, utilisé tel quel ci-dessous
   pour les montants).
   ═══════════════════════════════════════════════════════════════════════════ */

function parserEntierPositif(saisie: string): number | null {
  const nettoyee = saisie.trim();
  if (!/^\d+$/.test(nettoyee)) return null;
  const valeur = Number.parseInt(nettoyee, 10);
  return valeur > 0 ? valeur : null;
}

/** « 100 », « 60 », « 12,5 » -> points de base (0 à 10000). */
function parserPourcentBp(saisie: string): number | null {
  const nettoye = saisie.trim().replace(',', '.').replace('%', '');
  if (nettoye === '' || !/^\d*\.?\d*$/.test(nettoye)) return null;
  const valeur = Number(nettoye);
  if (!Number.isFinite(valeur) || valeur < 0 || valeur > 100) return null;
  return Math.round(valeur * 100);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Dépenses
   ═══════════════════════════════════════════════════════════════════════════ */

const LIBELLE_CATEGORIE_DEPENSE: Readonly<Record<CategorieDepenseContrat, string>> = {
  matiere: 'Matière',
  emplacement: 'Emplacement',
  carburant: 'Carburant',
  materiel: 'Matériel',
  assurance: 'Assurance',
  formation: 'Formation',
  frais_bancaires: 'Frais bancaires',
  telecom: 'Télécom',
  autre: 'Autre',
};

const CATEGORIES_DEPENSE = Object.keys(LIBELLE_CATEGORIE_DEPENSE) as CategorieDepenseContrat[];

function statutAffichageDepense(l: DepenseLigneContrat): Statut {
  if (l.estAnnulee) return 'depassement';
  if (l.estAnnulation) return 'alerte';
  return 'conforme';
}

function libelleStatutDepense(l: DepenseLigneContrat): string {
  if (l.estAnnulee) return 'Annulée';
  if (l.estAnnulation) return 'Correction';
  return 'Active';
}

/**
 * Referme `depenseAnnuleeId` (`schemaDepenseLigne`, docs/21-CHAMPS-NON-LUS.md
 * §5) : la ligne « Correction » disait QU'elle corrigeait quelque chose,
 * jamais LAQUELLE — deux corrections dans la même liste étaient
 * indiscernables sans deviner par la date. La résolution reste un JOIN
 * d'affichage sur des données déjà chargées, jamais un second calcul
 * (`toutes` est la même liste que celle déjà rendue par le tableau).
 *
 * Fonction PURE et exportée (ni jsdom ni @testing-library/react dans ce
 * dépôt, CLAUDE.md §7) : prouve la résolution, pas le rendu réel dans le DOM.
 */
export function libelleCibleAnnulationDepense(
  depenseAnnuleeId: string | null,
  toutes: readonly DepenseLigneContrat[],
): string | null {
  if (depenseAnnuleeId === null) return null;
  const cible = toutes.find((d) => d.id === depenseAnnuleeId);
  if (cible === undefined) return null;
  return `corrige « ${cible.libelle} » du ${formaterDate(cible.dateDepense)} (${formaterMontant(cible.montantCents)} €)`;
}

/** Ligne enrichie de la résolution ci-dessus, calculée une seule fois pour
 * tout le tableau plutôt qu'à chaque cellule (voir l'appel de `useMemo`). */
type DepenseLigneAffichage = DepenseLigneContrat & { libelleAnnulation: string | null };

const COLONNES_DEPENSES: ReadonlyArray<ColonneTableau<DepenseLigneAffichage>> = [
  {
    cle: 'date',
    libelle: 'Date',
    largeur: '11%',
    alignement: 'texte',
    rendu: (l) => formaterDate(l.dateDepense),
  },
  {
    cle: 'libelle',
    libelle: 'Libellé',
    largeur: '23%',
    alignement: 'texte',
    rendu: (l) => l.libelle,
    titre: (l) => l.libelle,
  },
  {
    cle: 'categorie',
    libelle: 'Catégorie',
    largeur: '12%',
    alignement: 'texte',
    // La categorie est l'axe d'analyse de la depense : deux libelles longs
    // tronques au meme endroit se confondent, et on ne peut plus verifier une
    // ventilation.
    troncature: 'repli',
    rendu: (l) => LIBELLE_CATEGORIE_DEPENSE[l.categorie],
  },
  {
    cle: 'montant',
    libelle: 'Montant (€)',
    largeur: '13%',
    alignement: 'nombre',
    rendu: (l) => formaterMontant(l.montantCents),
  },
  {
    cle: 'deductible',
    libelle: 'Déductible (€)',
    largeur: '15%',
    alignement: 'nombre',
    rendu: (l) =>
      `${formaterMontant(l.montantDeductibleCents)} (${formaterPointsDeBase(l.deductibleBp)})`,
  },
  {
    cle: 'statut',
    libelle: 'Statut',
    largeur: '16%',
    alignement: 'texte',
    // `repli` : la résolution de `depenseAnnuleeId` (ligne muette ci-dessous)
    // n'est jamais coupée. Rangée à 32 px pour l'immense majorité des lignes
    // (« Active », sans rien à ajouter) — ne grandit que les rares lignes de
    // correction, exactement le coût que docs/07 §4.4 demande de payer là
    // où l'information le justifie, jamais partout.
    troncature: 'repli',
    rendu: (l) => (
      <>
        <PastilleStatut statut={statutAffichageDepense(l)} libelle={libelleStatutDepense(l)} />
        {/* `depenseAnnuleeId` résolu en texte VISIBLE, jamais en simple
            infobulle à la souris (CLAUDE.md §3 règle 10) — voir
            `libelleCibleAnnulationDepense` ci-dessus. */}
        {l.libelleAnnulation !== null && (
          <span className="block text-2xs text-ink-3">{l.libelleAnnulation}</span>
        )}
      </>
    ),
  },
  {
    cle: 'justificatif',
    libelle: 'Justificatif',
    largeur: '10%',
    alignement: 'texte',
    rendu: (l) =>
      l.justificatifPath !== null ? (
        <LienJustificatifDepense justificatif={l.justificatifPath} identifiant={l.id} />
      ) : (
        TIRET_ABSENT
      ),
  },
];

/**
 * Lien de téléchargement d'UN justificatif de dépense (`justificatifPath`,
 * `schemaDepenseLigne`, docs/21-CHAMPS-NON-LUS.md §1.8) — jamais affiché ni
 * ouvrable avant ce correctif, alors que ce sont exactement les pièces qui
 * appuient une déduction déclarée en cas de contrôle fiscal.
 *
 * MÊME garde que `LienPieceJointe` (`Factures.tsx`) et `LienJustificatifFrais`
 * (`Sessions.tsx`) contre l'exécution d'une Data URI dans le navigateur
 * (mission « surface d'attaque », 30/07/2026) : `download` FORCE
 * l'enregistrement sur disque au lieu d'une navigation vers la Data URI.
 * Copie locale plutôt qu'import cross-écran : les deux fichiers cités sont
 * hors du périmètre d'écriture de cette mission (`Sessions.tsx`) ou portent
 * déjà leur propre copie pour la même raison (`Factures.tsx`).
 */
function LienJustificatifDepense({
  justificatif,
  identifiant,
}: {
  readonly justificatif: string;
  readonly identifiant: string;
}) {
  return (
    <a
      href={justificatif}
      download={`justificatif-depense-${identifiant}`}
      className="text-xs font-medium text-accent hover:text-accent-hover"
    >
      Voir
    </a>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Immobilisations
   ═══════════════════════════════════════════════════════════════════════════ */

const LIBELLE_METHODE: Readonly<Record<MethodeAmortissementContrat, string>> = {
  lineaire: 'Linéaire',
  degressive: 'Dégressive',
};

const COLONNES_IMMOBILISATIONS: ReadonlyArray<ColonneTableau<ImmobilisationDetailContrat>> = [
  {
    cle: 'libelle',
    libelle: 'Libellé',
    largeur: '26%',
    alignement: 'texte',
    rendu: (l) => l.libelle,
    titre: (l) => l.libelle,
  },
  {
    cle: 'acquisition',
    libelle: 'Acquisition',
    largeur: '14%',
    alignement: 'texte',
    rendu: (l) => formaterDate(l.dateAcquisition),
  },
  {
    cle: 'montant',
    libelle: 'Montant (€)',
    largeur: '14%',
    alignement: 'nombre',
    rendu: (l) => formaterMontant(l.montantCents),
  },
  {
    cle: 'duree',
    libelle: 'Durée',
    largeur: '10%',
    alignement: 'nombre',
    rendu: (l) => `${l.dureeAmortissementAnnees} ans`,
  },
  {
    cle: 'methode',
    libelle: 'Méthode',
    largeur: '12%',
    alignement: 'texte',
    rendu: (l) => LIBELLE_METHODE[l.methode],
  },
  {
    cle: 'vnc',
    libelle: 'Valeur nette (€)',
    largeur: '24%',
    alignement: 'nombre',
    rendu: (l) => formaterMontant(l.valeurNetteActuelleCents),
  },
];

const COLONNES_ANNUITES: ReadonlyArray<
  ColonneTableau<ImmobilisationDetailContrat['annuites'][number]>
> = [
  {
    cle: 'exercice',
    libelle: 'Exercice',
    largeur: '34%',
    alignement: 'texte',
    rendu: (a) => String(a.exercice),
  },
  {
    cle: 'annuite',
    libelle: 'Annuité (€)',
    largeur: '33%',
    alignement: 'nombre',
    rendu: (a) => formaterMontant(a.montantCents),
  },
  {
    cle: 'vnc',
    libelle: 'VNC fin d’exercice (€)',
    largeur: '33%',
    alignement: 'nombre',
    rendu: (a) => formaterMontant(a.valeurNetteFinCents),
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   Échéancier réglementaire
   ═══════════════════════════════════════════════════════════════════════════ */

const LIBELLE_STATUT_ECHEANCE: Readonly<Record<EcheanceLigneContrat['statut'], string>> = {
  a_venir: 'À venir',
  faite: 'Faite',
  en_retard: 'En retard',
};

/**
 * `recurrence` (`schemaEcheanceLigne`, docs/21-CHAMPS-NON-LUS.md §5) : calculée,
 * testée, servie par `GET /echeances`, jamais affichée avant ce correctif —
 * rien ne disait si une échéance revient chaque année, chaque trimestre, tous
 * les cinq ans, ou une seule fois. Sans elle, une échéance « ponctuelle »
 * cochée « faite » a l'air identique à une échéance annuelle qui va se
 * représenter dans douze mois.
 */
const LIBELLE_RECURRENCE: Readonly<Record<EcheanceLigneContrat['recurrence'], string>> = {
  annuelle: 'annuelle',
  trimestrielle: 'trimestrielle',
  quinquennale: 'tous les 5 ans',
  ponctuelle: 'ponctuelle',
};

/**
 * Saisie du montant estimé d'une échéance, directement dans sa cellule de
 * tableau (audit du 30/07/2026 : `echeance.montantEstimeCents` était affichée
 * mais jamais saisissable — un échéancier qui ne pouvait jamais dire combien
 * une échéance allait coûter).
 *
 * NON CONTRÔLÉ EXPRÈS (`defaultValue`, pas `value`) : un champ CONTRÔLÉ
 * perdrait la frappe en cours dès qu'un AUTRE geste sur cet écran (marquer
 * une autre échéance faite, changer d'exercice…) redéclenche `chargerEcheances`
 * et régénère `lignesEcheances`. La `key` ci-dessous, elle, inclut la valeur
 * PERSISTÉE : React ne remonte ce champ (et donc n'efface la frappe en cours)
 * que lorsque la valeur enregistrée en base a réellement changé.
 *
 * Un champ laissé VIDE efface l'estimation (`null`) plutôt que de la remplacer
 * par 0 : une estimation devenue incertaine doit pouvoir redevenir « inconnue »
 * (CLAUDE.md : « une valeur inconnue vaut `null`, jamais `0` »).
 */
export function ChampMontantEstimeEcheance({
  valeurInitialeCents,
  onValider,
}: {
  readonly valeurInitialeCents: number | null;
  readonly onValider: (montantEstimeCents: number | null) => void;
}) {
  const [erreur, setErreur] = useState<string | null>(null);

  function valider(saisie: string): void {
    const nettoyee = saisie.trim();
    if (nettoyee === '') {
      setErreur(null);
      onValider(null);
      return;
    }
    const valeur = parserEuros(nettoyee);
    if (valeur === null || valeur < 0) {
      setErreur('Montant invalide.');
      return;
    }
    setErreur(null);
    onValider(valeur);
  }

  return (
    <div className="flex flex-col gap-groupe">
      <input
        type="text"
        inputMode="decimal"
        aria-label="Montant estimé, en euros — jamais un montant dû"
        defaultValue={valeurInitialeCents === null ? '' : formaterMontant(valeurInitialeCents)}
        placeholder={TIRET_ABSENT}
        className="num h-controle w-28 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
        onBlur={(e) => valider(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          e.currentTarget.blur();
        }}
      />
      {erreur !== null && <span className="text-2xs text-depassement">{erreur}</span>}
    </div>
  );
}

/** Statut d'affichage : en retard se lit comme un dépassement, une échéance
 * qui approche comme une alerte. Le seuil d'approche vient du serveur
 * (`alerteProche`, calculé depuis `echeance_horizon_alerte_jours`) : il était
 * écrit en dur à 30 ici ET dans `TableauDeBord.tsx`. */
function statutAffichageEcheance(l: EcheanceLigneContrat): Statut {
  if (l.statut === 'faite') return 'conforme';
  if (l.statut === 'en_retard') return 'depassement';
  return l.alerteProche ? 'alerte' : 'conforme';
}

/**
 * Coupure d'AFFICHAGE du compte à rebours de la colonne « Prochaine date » :
 * au-delà de ce nombre de jours, la cellule montre la date seule, sans
 * compteur « J-n » (docs/29-VALEURS-EN-DUR.md §3/§6 point 3).
 *
 * SANS RAPPORT avec `echeance_horizon_alerte_jours` (30, lu côté serveur pour
 * `alerteProche` — voir le commentaire de `statutAffichageEcheance` ci-dessus) :
 * celui-là décide QUAND colorer la ligne en alerte, celui-ci décide JUSQU'À
 * QUAND afficher un compteur. Deux questions différentes, deux chiffres qui
 * n'ont aucune raison de coïncider — les confondre serait une régression, pas
 * une simplification.
 *
 * DÉSORMAIS UN VRAI PARAMÈTRE (mission du 01/08/2026, complément) :
 * `comptabilite_horizon_affichage_echeances_jours` (`packages/core/src/
 * parametres.ts`, valeur par défaut `60`, inchangée). Un littéral `60` nu
 * précédait ce correctif, puis un littéral NOMMÉ mais toujours en dur — une
 * valeur par défaut dans une signature de fonction ressemble à un réglage et
 * n'en est pas un. `null` tant que `/parametres` n'a pas répondu : voir
 * `colonnesEcheances` ci-dessous, qui refuse d'inventer un horizon (CLAUDE.md
 * « valeur inconnue -> null ») — même discipline que `horizonDlcJours` dans
 * `Stock.tsx`/`Production.tsx`/`TableauDeBord.tsx`.
 */

/**
 * Valeur ENTIÈRE en vigueur d'un paramètre du catalogue, à partir d'une
 * réponse déjà validée de `GET /parametres` (qui rend TOUTES les versions,
 * passées et futures, de TOUS les paramètres — docs/06).
 *
 * DUPLIQUÉE plutôt que partagée : aucun fichier hors `apps/web/src/pages/**`
 * n'est dans la zone d'écriture de cette mission (même contrainte déjà
 * documentée dans `Stock.tsx`/`Production.tsx`/`TableauDeBord.tsx`) — à
 * redescendre dans `apps/web/src/lib/` dès que cette contrainte se lève.
 *
 * Rend `null` si la clé est absente : mieux vaut un horizon silencieusement
 * absent qu'une valeur inventée.
 */
function valeurEntiereParametre(
  lignes: readonly Parametre[],
  cle: string,
  jour: string,
): number | null {
  const versions = lignes
    .filter((p) => p.cle === cle)
    .sort((a, b) => b.dateDebutValidite.localeCompare(a.dateDebutValidite));
  if (versions.length === 0) return null;
  const enVigueur =
    versions.find((v) => v.dateDebutValidite <= jour) ?? versions[versions.length - 1]!;
  return Number.parseInt(enVigueur.valeur, 10);
}

/**
 * Colonnes de l'échéancier, PARAMÉTRÉES par l'horizon d'affichage résolu
 * depuis `/parametres` (voir `horizonAffichageEcheancesJours` dans le
 * composant). Fonction plutôt que constante de module : la valeur n'est
 * connue qu'après le premier rendu, exactement le même patron que
 * `colonnesStock(..., horizonDlcJours)` dans `Stock.tsx`.
 *
 * `horizonAffichageEcheancesJours === null` (paramètre pas encore chargé, ou
 * appel réseau en échec — confort d'affichage, jamais une dépendance,
 * CLAUDE.md §5) : la colonne « Prochaine date » montre alors la date SEULE,
 * sans compteur — jamais un horizon inventé.
 */
export function colonnesEcheances(horizonAffichageEcheancesJours: number | null): ReadonlyArray<
  ColonneTableau<
    EcheanceLigneContrat & {
      onMarquerFaite: () => void;
      onEstimerMontant: (montantEstimeCents: number | null) => void;
    }
  >
> {
  return [
    {
      cle: 'libelle',
      libelle: 'Échéance',
      largeur: '21%',
      alignement: 'texte',
      // Deux corrections ici. D'abord `repli` : le libelle d'une echeance legale
      // ne peut pas etre coupe, c'est ce qui dit QUOI faire.
      troncature: 'repli',
      // `recurrence` (voir `LIBELLE_RECURRENCE` ci-dessus) rendue EN TEXTE, pas
      // seulement en infobulle : une information qui décide si l'échéance va
      // se représenter ne peut pas dépendre de la souris (CLAUDE.md §3 règle 10).
      rendu: (l) => (
        <>
          {l.libelle}{' '}
          <span className="text-2xs text-ink-3">({LIBELLE_RECURRENCE[l.recurrence]})</span>
        </>
      ),
      // Ensuite l'infobulle. Elle ne portait que `sourceLegale`, donc elle ne
      // restituait PAS le texte coupe : seule colonne du projet ou survoler
      // repondait a cote. Une infobulle doit toujours commencer par le contenu
      // rendu ; la source legale n'en est que le complement.
      titre: (l) => `${l.libelle} (${LIBELLE_RECURRENCE[l.recurrence]}) — ${l.sourceLegale}`,
    },
    {
      cle: 'date',
      libelle: 'Prochaine date',
      largeur: '14%',
      alignement: 'texte',
      rendu: (l) => {
        // `horizonAffichageEcheancesJours === null` (paramètre pas encore
        // chargé) : la date s'affiche SEULE, sans compteur — jamais un
        // horizon inventé (même discipline que `rendreDlc` dans `Stock.tsx`).
        const compteur =
          horizonAffichageEcheancesJours === null
            ? null
            : formaterJoursRestants(l.prochaineDate, aujourdHui(), horizonAffichageEcheancesJours);
        return (
          <span className="inline-flex items-baseline gap-groupe">
            <span>{formaterDate(l.prochaineDate)}</span>
            {compteur !== null && <span className="text-xs text-ink-3">{compteur}</span>}
          </span>
        );
      },
    },
    {
      cle: 'statut',
      libelle: 'Statut',
      largeur: '12%',
      alignement: 'texte',
      rendu: (l) => (
        <PastilleStatut
          statut={statutAffichageEcheance(l)}
          libelle={LIBELLE_STATUT_ECHEANCE[l.statut]}
        />
      ),
    },
    {
      cle: 'montantEstime',
      libelle: 'Montant estimé (€)',
      largeur: '15%',
      alignement: 'nombre',
      rendu: (l) => (
        <ChampMontantEstimeEcheance
          key={`${l.id}:${l.montantEstimeCents ?? 'null'}`}
          valeurInitialeCents={l.montantEstimeCents}
          onValider={l.onEstimerMontant}
        />
      ),
    },
    {
      cle: 'realisation',
      // En-tete court : « Dernière réalisation » se tronquait dans sa colonne.
      libelle: 'Réalisée le',
      largeur: '13%',
      alignement: 'texte',
      rendu: (l) => ouTiret(l.dateRealisation, (d) => formaterDate(d)),
    },
    {
      cle: 'source',
      libelle: 'Source',
      largeur: '7%',
      alignement: 'texte',
      rendu: (l) =>
        l.urlSource === null ? (
          TIRET_ABSENT
        ) : (
          <a
            href={l.urlSource}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:text-accent-hover"
          >
            Lien
          </a>
        ),
    },
    {
      cle: 'action',
      libelle: '',
      // 18 % : en dessous, le bouton « Marquer faite » deborde du panneau.
      largeur: '18%',
      alignement: 'texte',
      // `data-echeance` cible la cellule MEME quand le bouton disparait (une
      // fois `statut === 'faite'`) : `cleEcheanceAFocaliserApresPointage`
      // pointe la PROCHAINE echeance actionnable, jamais celle-ci.
      rendu: (l) => (
        <span data-echeance={l.id}>
          {l.statut !== 'faite' && (
            <button
              type="button"
              onClick={l.onMarquerFaite}
              className="h-controle rounded-sm border border-line-field px-2 text-xs text-ink-2 hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Marquer faite
            </button>
          )}
        </span>
      ),
    },
  ];
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ventes par créneau horaire (fiche 13, docs/17)
   ═══════════════════════════════════════════════════════════════════════════ */

const COLONNES_VENTES_CRENEAU: ReadonlyArray<ColonneTableau<LigneAgregatCreneauContrat>> = [
  {
    cle: 'creneau',
    libelle: 'Créneau',
    largeur: '22%',
    alignement: 'texte',
    troncature: 'repli',
    // Un texte explicite plutôt que le tiret générique de `ouTiret` : ce
    // n'est pas une valeur manquante sur CETTE ligne, c'est le bucket qui
    // recueille toutes les ventes dont le créneau n'a pas été saisi.
    rendu: (l) => l.creneauHoraire ?? 'Non renseigné',
  },
  {
    cle: 'sessions',
    libelle: 'Sessions',
    largeur: '12%',
    alignement: 'nombre',
    rendu: (l) => String(l.nbSessions),
  },
  {
    cle: 'quantite',
    libelle: 'Quantité vendue',
    largeur: '15%',
    alignement: 'nombre',
    rendu: (l) => String(l.quantiteVendue),
  },
  {
    cle: 'ca',
    libelle: 'CA (€)',
    largeur: '15%',
    alignement: 'nombre',
    rendu: (l) => formaterMontant(l.caCents),
  },
  {
    cle: 'margeBrute',
    libelle: 'Marge brute estimée (€)',
    largeur: '18%',
    alignement: 'nombre',
    rendu: (l) => ouTiret(l.margeBruteEstimeeCents, (m) => formaterMontant(m)),
    // `nbSessionsAvecMargeConnue` (`schemaLigneAgregatCreneau`,
    // docs/21-CHAMPS-NON-LUS.md §5) : sur COMBIEN de sessions cette marge
    // est répartie — jamais dit avant ce correctif, alors que le commentaire
    // du contrat précise qu'une session sans marge connue n'y entre pas :
    // une marge reposant sur 1 session sur 8 n'a pas la même fiabilité
    // qu'une marge reposant sur 8 sur 8.
    titre: (l) =>
      `${ouTiret(l.margeBruteEstimeeCents, (m) => formaterMontant(m))} — répartie sur ${l.nbSessionsAvecMargeConnue}/${l.nbSessions} session${l.nbSessions > 1 ? 's' : ''} avec marge connue`,
  },
  {
    cle: 'margeNette',
    libelle: 'Marge nette estimée (€)',
    largeur: '18%',
    alignement: 'nombre',
    rendu: (l) => ouTiret(l.margeNetteEstimeeCents, (m) => formaterMontant(m)),
    titre: (l) =>
      `${ouTiret(l.margeNetteEstimeeCents, (m) => formaterMontant(m))} — répartie sur ${l.nbSessionsAvecMargeConnue}/${l.nbSessions} session${l.nbSessions > 1 ? 's' : ''} avec marge connue`,
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   Verrou de période
   ═══════════════════════════════════════════════════════════════════════════ */

const LIBELLE_STATUT_PERIODE: Readonly<Record<PeriodeLigneContrat['statut'], string>> = {
  ouverte: 'Ouverte',
  cloturee: 'Clôturée',
  verrouillee: 'Verrouillée',
};

function statutAffichagePeriode(statut: PeriodeLigneContrat['statut']): Statut {
  switch (statut) {
    case 'ouverte':
      return 'alerte';
    case 'cloturee':
    case 'verrouillee':
      return 'conforme';
  }
}

const NOMS_MOIS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

/* ═══════════════════════════════════════════════════════════════════════════
   Verrouillage définitif d'une période (docs/34-VERROU-COMPTABLE.md)

   « Point de non-retour » (docs/07-DOCTRINE-ERP-ET-DESIGN.md §1.6), TROISIÈME
   niveau après la fenêtre souple et la clôture — jamais posé par erreur : le
   clic sur la ligne n'ouvre qu'une confirmation CHIFFRÉE, qui exige elle-même
   un second geste délibéré (recopier le mois affiché) avant que le bouton
   final ne s'active. Aucun raccourci clavier ne peut l'atteindre : pas de
   `<form>` ici (même précaution que `BlocAnnulation.tsx`, « Entrée » ne doit
   jamais valider une action qu'on ne peut plus défaire), et rien n'écoute
   `Ctrl+S` sur cet écran.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * État de la vérification chiffrée d'impact (`GET /periodes/:id/impact-verrouillage`),
 * À CONSULTER AVANT le verrou, jamais après.
 *
 * PAS d'état « décompte à zéro » de repli : un échec de ce chargement doit
 * REFUSER le geste, jamais le proposer à l'aveugle (CLAUDE.md §3 : une valeur
 * inconnue vaut `null`, jamais `0` — ici, un décompte inconnu bloque même le
 * bouton d'ouverture de la confirmation, voir `confirmationVerrouillageActivable`
 * et `ImpactVerrouillagePeriode` ci-dessous, qui n'affichent NI champ de
 * confirmation NI bouton final tant que cet état n'est pas `'pret'`).
 */
type EtatImpactVerrouillage =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; impact: ImpactVerrouillagePeriodeContrat };

/**
 * Texte EXACT que l'utilisateur doit recopier pour activer le bouton final —
 * le geste délibéré secondaire exigé en plus du clic qui ouvre la
 * confirmation. Même mois que celui affiché sur la ligne de `Périodes`,
 * jamais reformulé (sans quoi recopier « ce qu'on voit » ne suffirait plus).
 */
export function texteConfirmationVerrouillagePeriode(mois: number, annee: number): string {
  return `${NOMS_MOIS[mois - 1]} ${annee}`;
}

/**
 * Décision PURE, extraite pour être testable sans navigateur (CLAUDE.md §7) :
 * le bouton « Verrouiller définitivement » ne s'active QUE si (1) l'impact
 * chiffré a été obtenu AVEC SUCCÈS — un échec de `GET /impact-verrouillage`
 * refuse le geste, il ne le laisse jamais passer à l'aveugle (docs/34) — ET
 * (2) le texte recopié correspond EXACTEMENT au mois affiché. Aucune des deux
 * conditions ne suffit seule : une saisie correcte sur un impact inconnu
 * resterait un verrou posé sans savoir ce qu'il fige réellement.
 */
export function confirmationVerrouillageActivable(
  etatImpact: EtatImpactVerrouillage,
  saisieConfirmation: string,
  texteAttendu: string,
): boolean {
  return etatImpact.statut === 'pret' && saisieConfirmation.trim() === texteAttendu;
}

/**
 * Accord minimal singulier/pluriel — `n > 1`, jamais `n === 1`, pour rester
 * cohérent avec TOUTES les autres occurrences de ce motif dans ce dépôt
 * (`Stock.tsx`, `DetailLot.tsx`, `TableauDeBord.tsx`…) : 0 et 1 restent au
 * singulier, le pluriel commence à 2.
 */
function accord(n: number): string {
  return n > 1 ? 's' : '';
}

/**
 * Décompte CHIFFRÉ d'un verrouillage — rendu SANS calcul local, les six
 * compteurs viennent tels quels de `calculerImpactVerrouillagePeriode`
 * (`packages/db`) : ce composant affiche, il ne recalcule rien (CLAUDE.md §3
 * règle 1).
 *
 * DEUX familles, JAMAIS additionnées, jamais dans le même bloc visuel
 * (contrainte n°1 de cette mission, docs/34 §2 et §5) : les quatre premiers
 * comptes deviennent DÉFINITIVEMENT incorrigibles (leur seule voie de
 * correction vérifie le verrou sur la date D'ORIGINE de l'écriture) ;
 * `depensesCount` et `immobilisationsCount` restent INFORMATIFS SEULEMENT —
 * une dépense de ce mois reste annulable par contre-écriture datée
 * d'AUJOURD'HUI tant que le mois courant reste ouvert, et une immobilisation
 * n'a de toute façon aucun mécanisme d'annulation, verrouillée ou non. Les
 * mélanger mentirait sur ce que ce verrou fige réellement.
 *
 * TROISIÈME point informatif, SANS compteur : les factures fournisseur, que
 * ce verrou ne regarde pas du tout (`services/factures.ts` n'appelle jamais
 * `verifierPeriodeNonVerrouillee`). Un avertissement qui EXAGÈRE la portée
 * est aussi mauvais qu'un avertissement absent — le porteur apprendrait à
 * cliquer sans lire. Voir le commentaire posé sur ce `<li>` pour la
 * démonstration.
 *
 * ÉCHEC DE CHARGEMENT : ni champ de confirmation ni bouton — un décompte
 * inconnu REFUSE le geste, il ne l'affiche pas « à zéro ».
 *
 * Glyphe ▲ (docs/07 §4.8, réservé à ce qui demande une action métier) : UNE
 * seule fois dans tout ce bloc, sur la phrase d'irréversibilité — jamais sur
 * les compteurs eux-mêmes, pour ne pas diluer le signal.
 */
export function ImpactVerrouillagePeriode({ etat }: { etat: EtatImpactVerrouillage }) {
  if (etat.statut === 'chargement') {
    return <p className="text-sm text-ink-3">Calcul de l’impact…</p>;
  }

  if (etat.statut === 'erreur') {
    return (
      <div className="flex flex-col gap-groupe">
        <BandeauErreur message={etat.message} />
        <p className="text-sm font-medium text-ink">
          Verrouillage refusé : son impact n’a pas pu être vérifié avant de le poser.
        </p>
      </div>
    );
  }

  const { impact } = etat;
  return (
    <div className="flex flex-col gap-groupe">
      <div>
        <PastilleStatut statut="depassement" libelle="Définitivement incorrigible" />
        <ul className="mt-1 flex flex-col gap-1 text-sm text-ink">
          <li>
            {impact.mouvementsStockNonAnnulesCount} mouvement
            {accord(impact.mouvementsStockNonAnnulesCount)} de stock non annulé
            {accord(impact.mouvementsStockNonAnnulesCount)}
          </li>
          <li>
            {impact.receptionsNonAnnuleesCount} réception{accord(impact.receptionsNonAnnuleesCount)}{' '}
            non annulée{accord(impact.receptionsNonAnnuleesCount)}
          </li>
          <li>
            {impact.productionsNonAnnuleesCount} production
            {accord(impact.productionsNonAnnuleesCount)} non annulée
            {accord(impact.productionsNonAnnuleesCount)}
          </li>
          <li>
            {impact.sessionsNonAnnuleesCount} session{accord(impact.sessionsNonAnnuleesCount)} non
            annulée{accord(impact.sessionsNonAnnuleesCount)}
          </li>
        </ul>
      </div>
      <div>
        <h4 className="text-2xs uppercase text-ink-3">
          Informatif seulement — non figé par ce verrou
        </h4>
        <ul className="mt-1 flex flex-col gap-1 text-sm text-ink-2">
          <li>
            {impact.depensesCount} dépense{accord(impact.depensesCount)} de ce mois — reste
            annulable par contre-écriture datée d’aujourd’hui, tant que le mois courant est ouvert
          </li>
          <li>
            {impact.immobilisationsCount} immobilisation{accord(impact.immobilisationsCount)} de ce
            mois — aucun mécanisme d’annulation, verrouillée ou non
          </li>
          {/*
           * SANS COMPTEUR, délibérément : `ImpactVerrouillagePeriode`
           * (`packages/db`) ne renvoie aucun décompte de factures, et
           * l'inventer ici serait un calcul dans un composant (CLAUDE.md §3
           * règle 1). La phrase énonce un FAIT de portée, pas un chiffre.
           *
           * Ce fait est vérifié, pas supposé : `packages/db/src/services/factures.ts`
           * n'appelle JAMAIS `verifierPeriodeNonVerrouillee` (zéro occurrence
           * dans tout le fichier). Une facture datée d'un mois verrouillé
           * s'enregistre encore, change de statut, s'annule ; `corrigerCoutLot`
           * y réécrit `lot.prix_ligne_cents` ; et `enregistrerFacture` insère
           * des lignes `frais_reception` rattachées à une réception de ce
           * mois — que `totalFraisReceptionCents` reprend ensuite dans la
           * synthèse de l'exercice. Taire cet écart ferait lire « verrouillé »
           * comme « tout est figé », ce qui est faux.
           */}
          <li>
            Les factures fournisseur ne sont pas regardées par ce verrou — une facture reçue plus
            tard peut encore corriger le prix d’un lot de ce mois et y rattacher des frais de
            réception, qui entrent dans la synthèse de l’exercice
          </li>
        </ul>
      </div>
      <p
        role="alert"
        className="flex items-start gap-groupe border-l-2 border-alerte bg-alerte-bg px-3 py-2 text-sm font-medium text-alerte"
      >
        <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span>
        <span>Cette période ne pourra plus jamais être rouverte, y compris par ce logiciel.</span>
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   États d'écran
   ═══════════════════════════════════════════════════════════════════════════ */

type EtatSynthese =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; synthese: SyntheseExerciceContrat };

type EtatDepenses =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | {
      statut: 'pret';
      lignes: DepenseLigneContrat[];
      montantTotalCents: number;
      montantDeductibleTotalCents: number;
      montantImmobiliseTotalCents: number;
    };

type EtatImmobilisations =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; lignes: ImmobilisationDetailContrat[] };

type EtatEcheances =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; lignes: EcheanceLigneContrat[] };

/**
 * État de l'échéancier après un ÉCHEC de pointage (fiche 20, docs/17).
 *
 * Extraite du corps du `catch` de `marquerEcheanceFaite` pour qu'un test
 * puisse figer, SANS navigateur, que cette fonction ne fait rien d'autre que
 * produire l'état d'erreur — en particulier qu'elle ne recharge JAMAIS la
 * liste. Une fonction pure ne peut pas déclencher un rechargement réseau : le
 * défaut mesuré (l'échec rendu invisible par un rechargement silencieux
 * immédiat) est donc rendu structurellement impossible, pas seulement corrigé
 * par relecture.
 */
export function etatEcheancesApresEchecPointage(erreur: unknown): EtatEcheances {
  return { statut: 'erreur', message: messageErreurApi(erreur) };
}

/**
 * Cle de l'echeance a focaliser une fois qu'on vient d'en pointer une comme
 * « faite » (recette clavier du 30/07/2026 : le focus retombait sur `<body>`).
 *
 * LE GESTE REEL : l'echeancier se pointe du haut vers le bas, une echeance
 * apres l'autre — le bouton « Marquer faite » de CELLE-CI disparait une fois
 * l'action faite (la ligne reste, seul le bouton s'efface), donc il ne peut
 * jamais redevenir la cible. La continuite naturelle est la PROCHAINE echeance
 * encore actionnable — memes bornes que `cleAFocaliserApresRetrait`
 * (`saisie-stock/SaisieReception.tsx`, meme raisonnement transpose a une ligne
 * qui reste affichee plutot qu'a une ligne retiree) : si la pointee etait la
 * derniere actionnable, on revient sur la precedente ; s'il n'en reste aucune
 * (toutes les echeances a jour), `null` — l'appelant ne force alors rien, ce
 * qui reste le seul etat ou aucune cible de continuation n'existe.
 */
export function cleEcheanceAFocaliserApresPointage(
  lignesAvant: readonly Pick<EcheanceLigneContrat, 'id' | 'statut'>[],
  idPointee: string,
): string | null {
  const actionnablesAvant = lignesAvant.filter((l) => l.statut !== 'faite').map((l) => l.id);
  const indexAvant = actionnablesAvant.findIndex((id) => id === idPointee);
  const actionnablesApres = actionnablesAvant.filter((id) => id !== idPointee);
  if (actionnablesApres.length === 0) return null;
  const indexCible = Math.min(Math.max(indexAvant, 0), actionnablesApres.length - 1);
  return actionnablesApres[indexCible] ?? null;
}

type EtatPeriodes =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; lignes: PeriodeLigneContrat[] };

type EtatVentesParCreneau =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; lignes: LigneAgregatCreneauContrat[]; nbSessionsCloturees: number };

type EtatEcriture =
  { statut: 'inactif' } | { statut: 'en_cours' } | { statut: 'erreur'; message: string };

export default function Comptabilite() {
  const navigate = useNavigate();
  const [annee, setAnnee] = useState(anneeCourante);

  const [etatSynthese, setEtatSynthese] = useState<EtatSynthese>({ statut: 'chargement' });
  const [etatDepenses, setEtatDepenses] = useState<EtatDepenses>({ statut: 'chargement' });
  const [etatImmobilisations, setEtatImmobilisations] = useState<EtatImmobilisations>({
    statut: 'chargement',
  });
  const [etatEcheances, setEtatEcheances] = useState<EtatEcheances>({ statut: 'chargement' });
  const [etatPeriodes, setEtatPeriodes] = useState<EtatPeriodes>({ statut: 'chargement' });
  const [etatVentesParCreneau, setEtatVentesParCreneau] = useState<EtatVentesParCreneau>({
    statut: 'chargement',
  });

  /** Résolution de `depenseAnnuleeId` (voir `libelleCibleAnnulationDepense`),
   * calculée une seule fois pour tout le tableau plutôt qu'à chaque cellule. */
  const lignesDepensesAffichage = useMemo((): DepenseLigneAffichage[] => {
    if (etatDepenses.statut !== 'pret') return [];
    return etatDepenses.lignes.map((l) => ({
      ...l,
      libelleAnnulation: libelleCibleAnnulationDepense(l.depenseAnnuleeId, etatDepenses.lignes),
    }));
  }, [etatDepenses]);

  /**
   * Coût kilométrique retenu (forfait ou mesuré, fiche 13 §3.1) — repère
   * informatif affiché au point de saisie d'une dépense « carburant », `null`
   * tant qu'il n'a pas pu être lu. Dégradé volontaire (CLAUDE.md §5) : c'est
   * un complément à cet écran, pas sa raison d'être, exactement comme le
   * diagnostic de disjonction de l'écran Lieux de marché.
   */
  const [coutKilometrique, setCoutKilometrique] = useState<{
    origine: OrigineCoutKilometriqueContrat;
    libelle: string;
  } | null>(null);

  /**
   * Horizon d'affichage du compteur « J-n » de l'échéancier, lu depuis
   * `comptabilite_horizon_affichage_echeances_jours` (voir `colonnesEcheances`
   * ci-dessus). `null` tant que `/parametres` n'a pas répondu : confort
   * d'affichage, jamais une dépendance (CLAUDE.md §5) — sans lui,
   * `colonnesEcheances` continue de montrer la date, seul le compteur
   * disparaît. Même patron que `horizonDlcJours` dans `Stock.tsx`.
   */
  const [horizonAffichageEcheancesJours, setHorizonAffichageEcheancesJours] = useState<
    number | null
  >(null);

  useEffect(() => {
    let annule = false;

    requeteApi<unknown>('/parametres')
      .then((reponse) => {
        if (annule) return;
        const liste = schemaListeParametres.parse(reponse);
        const valeur = valeurEntiereParametre(
          liste.data,
          'comptabilite_horizon_affichage_echeances_jours',
          aujourdHui(),
        );
        if (valeur !== null) setHorizonAffichageEcheancesJours(valeur);
      })
      .catch(() => {
        // Confort d'affichage, jamais une dépendance (CLAUDE.md §5) : sans ce
        // paramètre, `colonnesEcheances` continue de montrer la date, seul le
        // compteur « J-n » reste absent.
      });

    return () => {
      annule = true;
    };
  }, []);

  // ─── Création rapide : dépense ───────────────────────────────────────────
  const [creationDepenseOuverte, setCreationDepenseOuverte] = useState(false);
  const [dateDepenseSaisie, setDateDepenseSaisie] = useState(aujourdHui);
  const [libelleDepenseSaisie, setLibelleDepenseSaisie] = useState('');
  const [categorieDepenseSaisie, setCategorieDepenseSaisie] =
    useState<CategorieDepenseContrat>('autre');
  const [montantDepenseSaisie, setMontantDepenseSaisie] = useState('');
  const [deductibleDepenseSaisie, setDeductibleDepenseSaisie] = useState('100');
  const [etatCreationDepense, setEtatCreationDepense] = useState<EtatEcriture>({
    statut: 'inactif',
  });

  // ─── Annulation d'une dépense ────────────────────────────────────────────
  const [depenseEnAnnulationId, setDepenseEnAnnulationId] = useState<string | null>(null);
  const [motifAnnulationDepense, setMotifAnnulationDepense] = useState('');
  const [etatAnnulationDepense, setEtatAnnulationDepense] = useState<EtatEcriture>({
    statut: 'inactif',
  });

  // ─── Création rapide : immobilisation ────────────────────────────────────
  const [creationImmoOuverte, setCreationImmoOuverte] = useState(false);
  const [libelleImmoSaisie, setLibelleImmoSaisie] = useState('');
  const [dateImmoSaisie, setDateImmoSaisie] = useState(aujourdHui);
  const [montantImmoSaisie, setMontantImmoSaisie] = useState('');
  const [dureeImmoSaisie, setDureeImmoSaisie] = useState('5');
  const [methodeImmoSaisie, setMethodeImmoSaisie] =
    useState<MethodeAmortissementContrat>('lineaire');
  const [valeurResiduelleImmoSaisie, setValeurResiduelleImmoSaisie] = useState('0');
  const [etatCreationImmo, setEtatCreationImmo] = useState<EtatEcriture>({ statut: 'inactif' });
  const [immoSelectionneeId, setImmoSelectionneeId] = useState<string | null>(null);

  // ─── Périodes ─────────────────────────────────────────────────────────────
  const [periodeEnReouvertureId, setPeriodeEnReouvertureId] = useState<string | null>(null);
  const [motifReouverturePeriode, setMotifReouverturePeriode] = useState('');
  /**
   * `clotureePar` (`schemaClotureRequisePeriode`, docs/21-CHAMPS-NON-LUS.md
   * §1.9) : le champ existait côté contrat et côté dépôt (`cloturerPeriode`
   * l'accepte déjà en troisième paramètre optionnel), mais AUCUN écran ne le
   * saisissait — la valeur restait `null` pour toujours, quoi qu'on affiche.
   * Facultative à dessein (deux personnes, `CLAUDE.md` §1, mais un mois peut
   * être clôturé seul un dimanche soir sans que ce soit une anomalie) :
   * laisser vide envoie `null`, comportement IDENTIQUE à avant ce correctif.
   */
  const [clotureeParSaisie, setClotureeParSaisie] = useState('');
  const [etatEcriturePeriode, setEtatEcriturePeriode] = useState<EtatEcriture>({
    statut: 'inactif',
  });

  // ─── Verrouillage définitif d'une période ─────────────────────────────────
  // État SÉPARÉ de `etatEcriturePeriode` ci-dessus (clôture/réouverture) : les
  // deux confirmations vivent à des endroits différents de l'écran, une
  // erreur de l'une ne doit jamais s'afficher à côté de l'autre.
  const [periodeEnVerrouillageId, setPeriodeEnVerrouillageId] = useState<string | null>(null);
  const [etatImpactVerrouillage, setEtatImpactVerrouillage] = useState<EtatImpactVerrouillage>({
    statut: 'chargement',
  });
  /** Recopie du mois affiché — le geste délibéré secondaire (voir la section
   * « Verrouillage définitif » ci-dessus). */
  const [confirmationVerrouillageSaisie, setConfirmationVerrouillageSaisie] = useState('');
  const [etatEcritureVerrouillage, setEtatEcritureVerrouillage] = useState<EtatEcriture>({
    statut: 'inactif',
  });

  /* ─── Clavier (CLAUDE.md règle 10, docs/07 §4.6–4.7) ──────────────────────
     Cet écran ouvre quatre surfaces escamotables. Sans ces références, ouvrir
     un panneau laissait le focus sur le bouton bascule et il fallait tabuler à
     l'aveugle jusqu'au premier champ ; refermer un panneau après un
     enregistrement démontait le bouton qui avait le focus, qui retombait sur
     `<body>` — donc re-tabuler depuis le haut de la page pour saisir la
     dépense suivante. */
  const boutonNouvelleDepense = useRef<HTMLButtonElement>(null);
  const boutonNouvelleImmo = useRef<HTMLButtonElement>(null);
  // Ancre de secours pour la réouverture de période : le bouton « Rouvrir »
  // qui l'ouvre est propre à chaque ligne du tableau (docs/07 §4.5, pas de
  // ref imperative exposee par `Tableau.tsx`) — memes principe et limite que
  // `boutonNouvelleDepense`/`boutonNouvelleImmo` ci-dessus pour les panneaux
  // ouverts depuis une ligne.
  const boutonCloturerPeriode = useRef<HTMLButtonElement>(null);
  const champDateDepense = useRef<HTMLInputElement>(null);
  const champLibelleImmo = useRef<HTMLInputElement>(null);
  const champMotifAnnulation = useRef<HTMLInputElement>(null);
  const champMotifReouverture = useRef<HTMLInputElement>(null);
  /**
   * Boutons/champ du verrouillage définitif. `boutonConfirmerVerrouillage`
   * porte le piège de focus décrit dans la mission : `disabled={enCours}`
   * posé PENDANT qu'il a le focus le fait lâcher par le navigateur avant
   * tout rendu React (même patron que `boutonSortir`, `Stock.tsx`) — un échec
   * doit donc lui rendre le focus par `requestAnimationFrame`, jamais par un
   * `.focus()` direct (voir `confirmerVerrouillagePeriode`).
   */
  const champConfirmationVerrouillage = useRef<HTMLInputElement>(null);
  const boutonConfirmerVerrouillage = useRef<HTMLButtonElement>(null);
  const boutonFermerErreurVerrouillage = useRef<HTMLButtonElement>(null);
  // Portee de l'echeancier : `cleEcheanceAFocaliser` cible une echeance PAR
  // SON ID, jamais par un ref direct sur son bouton — `Tableau.tsx` n'expose
  // aucune ref imperative par ligne (meme limite que `boutonCloturerPeriode`
  // ci-dessus), et le bouton vise n'existe pas forcement encore au rendu ou
  // l'on decide de la cible (voir `marquerEcheanceFaite`).
  const refListeEcheances = useRef<HTMLDivElement>(null);
  const [cleEcheanceAFocaliser, setCleEcheanceAFocaliser] = useState<string | null>(null);

  // Le focus entre dans le panneau qu'on vient d'ouvrir, sur son premier champ.
  useEffect(() => {
    if (creationDepenseOuverte) champDateDepense.current?.focus();
  }, [creationDepenseOuverte]);

  useEffect(() => {
    if (creationImmoOuverte) champLibelleImmo.current?.focus();
  }, [creationImmoOuverte]);

  useEffect(() => {
    if (depenseEnAnnulationId !== null) champMotifAnnulation.current?.focus();
  }, [depenseEnAnnulationId]);

  useEffect(() => {
    if (periodeEnReouvertureId !== null) champMotifReouverture.current?.focus();
  }, [periodeEnReouvertureId]);

  // Recharge l'impact chiffré à CHAQUE ouverture (y compris une réouverture
  // du même panneau) : les compteurs peuvent avoir changé entre deux clics,
  // et un impact obtenu la fois précédente ne dit rien de l'état actuel.
  useEffect(() => {
    if (periodeEnVerrouillageId === null) return;
    setEtatImpactVerrouillage({ statut: 'chargement' });
    requeteApi<unknown>(`/periodes/${periodeEnVerrouillageId}/impact-verrouillage`)
      .then((reponse) => {
        setEtatImpactVerrouillage({
          statut: 'pret',
          impact: schemaImpactVerrouillagePeriode.parse(reponse),
        });
      })
      .catch((erreur: unknown) => {
        // ÉCHEC : l'état passe à `'erreur'`, jamais à `'pret'` avec des
        // compteurs à zéro inventés — `ImpactVerrouillagePeriode` refuse
        // alors le geste (ni champ de confirmation ni bouton final).
        setEtatImpactVerrouillage({ statut: 'erreur', message: messageErreurApi(erreur) });
      });
  }, [periodeEnVerrouillageId]);

  // Le focus entre dans la confirmation dès qu'elle a quelque chose
  // d'actionnable : le champ de recopie si l'impact est connu, le bouton
  // « Fermer » si son chargement a échoué (aucun champ à proposer alors).
  useEffect(() => {
    if (periodeEnVerrouillageId === null) return;
    if (etatImpactVerrouillage.statut === 'pret') {
      champConfirmationVerrouillage.current?.focus();
    } else if (etatImpactVerrouillage.statut === 'erreur') {
      boutonFermerErreurVerrouillage.current?.focus();
    }
  }, [periodeEnVerrouillageId, etatImpactVerrouillage.statut]);

  // Continue le pointage de l'echeancier sur la PROCHAINE echeance actionnable
  // (recette clavier du 30/07/2026 — voir `cleEcheanceAFocaliserApresPointage`
  // ci-dessus). Le bouton cible existe deja au moment ou cet effet s'execute :
  // marquer une echeance faite ne modifie NI l'id NI la cle React des AUTRES
  // lignes, qui ne sont donc jamais demontees par le rechargement en tache de
  // fond (`rechargerEcheancesEnArrierePlan`).
  useEffect(() => {
    if (cleEcheanceAFocaliser === null) return;
    refListeEcheances.current
      ?.querySelector<HTMLElement>(`[data-echeance="${cleEcheanceAFocaliser}"] button`)
      ?.focus();
    setCleEcheanceAFocaliser(null);
  }, [cleEcheanceAFocaliser]);

  // « Échap ferme » (docs/07 §4.6), comme le font déjà `Achats.tsx` et
  // `Production.tsx`. Un seul écouteur pour les quatre surfaces : la plus
  // interne (une saisie de motif en cours) se referme en premier, sinon on
  // referme les formulaires de création.
  useEffect(() => {
    function surAppuiTouche(evenement: KeyboardEvent): void {
      if (evenement.key !== 'Escape') return;
      if (depenseEnAnnulationId !== null) {
        setDepenseEnAnnulationId(null);
        boutonNouvelleDepense.current?.focus();
        return;
      }
      if (periodeEnReouvertureId !== null) {
        setPeriodeEnReouvertureId(null);
        boutonCloturerPeriode.current?.focus();
        return;
      }
      if (periodeEnVerrouillageId !== null) {
        // Échap FERME, jamais ne confirme (aucun raccourci clavier ne doit
        // pouvoir déclencher un verrouillage). Même geste que `fermerVerrouillage`
        // ci-dessous, réécrit ici pour ne pas ajouter cette fonction aux
        // dépendances de l'effet (elle est recréée à chaque rendu).
        setPeriodeEnVerrouillageId(null);
        setConfirmationVerrouillageSaisie('');
        setEtatEcritureVerrouillage({ statut: 'inactif' });
        boutonCloturerPeriode.current?.focus();
        return;
      }
      if (creationDepenseOuverte) {
        setCreationDepenseOuverte(false);
        boutonNouvelleDepense.current?.focus();
        return;
      }
      if (creationImmoOuverte) {
        setCreationImmoOuverte(false);
        boutonNouvelleImmo.current?.focus();
        return;
      }
      if (immoSelectionneeId !== null) {
        setImmoSelectionneeId(null);
        boutonNouvelleImmo.current?.focus();
      }
    }
    window.addEventListener('keydown', surAppuiTouche);
    return () => window.removeEventListener('keydown', surAppuiTouche);
  }, [
    depenseEnAnnulationId,
    periodeEnReouvertureId,
    periodeEnVerrouillageId,
    creationDepenseOuverte,
    creationImmoOuverte,
    immoSelectionneeId,
  ]);

  function chargerSynthese(): void {
    setEtatSynthese({ statut: 'chargement' });
    requeteApi<unknown>(`/synthese-exercice?annee=${annee}`)
      .then((reponse) =>
        setEtatSynthese({ statut: 'pret', synthese: schemaSyntheseExercice.parse(reponse) }),
      )
      .catch((erreur: unknown) => {
        setEtatSynthese({ statut: 'erreur', message: messageErreurApi(erreur) });
      });
  }

  function chargerDepenses(): void {
    setEtatDepenses({ statut: 'chargement' });
    requeteApi<unknown>(`/depenses?annee=${annee}`)
      .then((reponse) => {
        const liste = schemaListeDepenses.parse(reponse);
        setEtatDepenses({
          statut: 'pret',
          lignes: liste.data,
          montantTotalCents: liste.meta.montantTotalCents,
          montantDeductibleTotalCents: liste.meta.montantDeductibleTotalCents,
          montantImmobiliseTotalCents: liste.meta.montantImmobiliseTotalCents,
        });
      })
      .catch((erreur: unknown) => {
        setEtatDepenses({ statut: 'erreur', message: messageErreurApi(erreur) });
      });
  }

  function chargerImmobilisations(): void {
    setEtatImmobilisations({ statut: 'chargement' });
    requeteApi<unknown>(`/immobilisations?annee=${annee}`)
      .then((reponse) =>
        setEtatImmobilisations({
          statut: 'pret',
          lignes: schemaListeImmobilisations.parse(reponse).data,
        }),
      )
      .catch((erreur: unknown) => {
        setEtatImmobilisations({ statut: 'erreur', message: messageErreurApi(erreur) });
      });
  }

  function chargerEcheances(): void {
    setEtatEcheances({ statut: 'chargement' });
    requeteApi<unknown>('/echeances')
      .then((reponse) =>
        setEtatEcheances({ statut: 'pret', lignes: schemaListeEcheances.parse(reponse).data }),
      )
      .catch((erreur: unknown) => {
        setEtatEcheances({ statut: 'erreur', message: messageErreurApi(erreur) });
      });
  }

  /**
   * Recharge les echeances SANS repasser par l'etat `{ statut: 'chargement' }`
   * intermediaire.
   *
   * DEFAUT MESURE (recette clavier du 30/07/2026), commun aux DEUX gestes
   * fautifs de l'echeancier (montant estime, marquer faite) : `chargerEcheances`
   * remplace tout l'echeancier par « Chargement… » le temps de l'aller-retour
   * reseau, PUIS le remonte — le `<Tableau>` ENTIER est demonte puis
   * reconstruit, avec tout ce qui s'y trouvait, y compris l'element sur lequel
   * `Tab` venait d'avancer depuis le champ qu'on quittait. Le focus retombe
   * alors sur `<body>` a la resolution de la promesse — pas au moment du geste
   * lui-meme, ce qui a rendu ce defaut long a rejouer.
   *
   * Un rechargement declenche par une sauvegarde DEJA EN COURS (montant
   * estime au blur, pointage) ne doit RIEN interrompre : cette fonction laisse
   * le `<Tableau>` monte tout du long et ne remplace que ses lignes — React
   * ne demonte alors QUE la cellule dont la valeur a reellement change (voir
   * la `key` de `ChampMontantEstimeEcheance` ci-dessus), jamais le reste de
   * l'ecran. Reservee aux DEUX rechargements « en tache de fond » ;
   * `chargerEcheances` reste utilisee pour le chargement INITIAL, ou rien n'a
   * encore le focus.
   */
  function rechargerEcheancesEnArrierePlan(): void {
    requeteApi<unknown>('/echeances')
      .then((reponse) => {
        setEtatEcheances({ statut: 'pret', lignes: schemaListeEcheances.parse(reponse).data });
      })
      .catch((erreur: unknown) => {
        setEtatEcheances(etatEcheancesApresEchecPointage(erreur));
      });
  }

  function chargerPeriodes(): void {
    setEtatPeriodes({ statut: 'chargement' });
    requeteApi<unknown>('/periodes')
      .then((reponse) =>
        setEtatPeriodes({ statut: 'pret', lignes: schemaListePeriodes.parse(reponse).data }),
      )
      .catch((erreur: unknown) => {
        setEtatPeriodes({ statut: 'erreur', message: messageErreurApi(erreur) });
      });
  }

  // Fiche 13 (docs/17) : le créneau horaire est saisi et affiché ligne par
  // ligne depuis longtemps, jamais agrégé. Suit le même exercice que le reste
  // de l'écran (`annee`) : pas de second sélecteur à tenir cohérent.
  function chargerVentesParCreneau(): void {
    setEtatVentesParCreneau({ statut: 'chargement' });
    requeteApi<unknown>(`/ventes-par-creneau?annee=${annee}`)
      .then((reponse) => {
        const liste = schemaListeVentesParCreneau.parse(reponse);
        setEtatVentesParCreneau({
          statut: 'pret',
          lignes: liste.data,
          nbSessionsCloturees: liste.meta.nbSessionsCloturees,
        });
      })
      .catch((erreur: unknown) => {
        setEtatVentesParCreneau({ statut: 'erreur', message: messageErreurApi(erreur) });
      });
  }

  // Fiche 13 §3.1 : coût kilométrique retenu (forfait ou mesuré), affiché en
  // repère au point de saisie d'une dépense « carburant » ci-dessous.
  function chargerCoutKilometrique(): void {
    requeteApi<unknown>('/lieux-rentabilite')
      .then((reponse) => {
        const liste = schemaListeComparaisonLieux.parse(reponse);
        setCoutKilometrique({
          origine: liste.meta.coutKilometriqueOrigine,
          libelle: liste.meta.coutKilometriqueLibelle,
        });
      })
      .catch(() => {
        // Dégradé volontaire : ce repère est un complément informatif, pas la
        // raison d'être de cet écran. Sans lui, la saisie des dépenses reste
        // pleinement utilisable — il disparaît simplement.
        setCoutKilometrique(null);
      });
  }

  useEffect(chargerSynthese, [annee]);
  useEffect(chargerDepenses, [annee]);
  useEffect(chargerImmobilisations, [annee]);
  useEffect(chargerEcheances, []);
  useEffect(chargerPeriodes, []);
  useEffect(chargerVentesParCreneau, [annee]);
  useEffect(chargerCoutKilometrique, []);

  async function creerDepense(): Promise<void> {
    if (libelleDepenseSaisie.trim() === '') {
      setEtatCreationDepense({ statut: 'erreur', message: 'Le libellé est obligatoire.' });
      return;
    }
    const montantValeur = parserEuros(montantDepenseSaisie);
    if (montantValeur === null || montantValeur <= 0) {
      setEtatCreationDepense({
        statut: 'erreur',
        message: 'Le montant doit être un montant valide supérieur à zéro.',
      });
      return;
    }
    const deductibleValeur = parserPourcentBp(deductibleDepenseSaisie);
    if (deductibleValeur === null) {
      setEtatCreationDepense({
        statut: 'erreur',
        message: 'La part déductible doit être un pourcentage entre 0 et 100.',
      });
      return;
    }
    if (etatCreationDepense.statut === 'en_cours') return;

    setEtatCreationDepense({ statut: 'en_cours' });
    try {
      await requeteApi('/depenses', {
        method: 'POST',
        body: JSON.stringify({
          dateDepense: dateDepenseSaisie,
          libelle: libelleDepenseSaisie.trim(),
          categorie: categorieDepenseSaisie,
          montantCents: montantValeur,
          deductibleBp: deductibleValeur,
        }),
      });
      setEtatCreationDepense({ statut: 'inactif' });
      setLibelleDepenseSaisie('');
      setMontantDepenseSaisie('');
      setDeductibleDepenseSaisie('100');
      setCreationDepenseOuverte(false);
      // Le panneau se referme et emporte le bouton qui avait le focus : on le
      // rend au bouton bascule, d'où la dépense suivante s'ouvre d'une frappe.
      boutonNouvelleDepense.current?.focus();
      chargerDepenses();
      chargerSynthese();
      // Un nouveau plein change potentiellement le nombre de pleins retenu
      // par `coutKilometriqueRetenu` (fiche 13 §3.1) : rafraîchi à chaque
      // dépense, pas seulement pour la catégorie carburant — coût nul si ce
      // n'est pas le cas.
      chargerCoutKilometrique();
    } catch (erreur: unknown) {
      setEtatCreationDepense({ statut: 'erreur', message: messageErreurApi(erreur) });
    }
  }

  async function confirmerAnnulationDepense(depenseId: string): Promise<void> {
    if (motifAnnulationDepense.trim() === '') {
      setEtatAnnulationDepense({
        statut: 'erreur',
        message: 'Indiquez pourquoi cette dépense est annulée.',
      });
      return;
    }
    setEtatAnnulationDepense({ statut: 'en_cours' });
    try {
      await requeteApi(`/depenses/${depenseId}/annuler`, {
        method: 'POST',
        body: JSON.stringify({ motif: motifAnnulationDepense.trim() }),
      });
      setDepenseEnAnnulationId(null);
      setMotifAnnulationDepense('');
      setEtatAnnulationDepense({ statut: 'inactif' });
      boutonNouvelleDepense.current?.focus();
      chargerDepenses();
      chargerSynthese();
      chargerCoutKilometrique();
    } catch (erreur: unknown) {
      setEtatAnnulationDepense({ statut: 'erreur', message: messageErreurApi(erreur) });
    }
  }

  async function creerImmobilisation(): Promise<void> {
    if (libelleImmoSaisie.trim() === '') {
      setEtatCreationImmo({ statut: 'erreur', message: 'Le libellé est obligatoire.' });
      return;
    }
    const montantValeur = parserEuros(montantImmoSaisie);
    if (montantValeur === null || montantValeur <= 0) {
      setEtatCreationImmo({
        statut: 'erreur',
        message: 'Le montant doit être un montant valide supérieur à zéro.',
      });
      return;
    }
    const dureeValeur = parserEntierPositif(dureeImmoSaisie);
    if (dureeValeur === null) {
      setEtatCreationImmo({
        statut: 'erreur',
        message: 'La durée d’amortissement doit être un nombre entier d’années.',
      });
      return;
    }
    const valeurResiduelleValeur = parserEuros(valeurResiduelleImmoSaisie);
    if (valeurResiduelleValeur === null || valeurResiduelleValeur < 0) {
      setEtatCreationImmo({
        statut: 'erreur',
        message: 'La valeur résiduelle doit être un montant valide.',
      });
      return;
    }
    if (etatCreationImmo.statut === 'en_cours') return;

    setEtatCreationImmo({ statut: 'en_cours' });
    try {
      await requeteApi('/immobilisations', {
        method: 'POST',
        body: JSON.stringify({
          libelle: libelleImmoSaisie.trim(),
          dateAcquisition: dateImmoSaisie,
          montantCents: montantValeur,
          dureeAmortissementAnnees: dureeValeur,
          methode: methodeImmoSaisie,
          valeurResiduelleCents: valeurResiduelleValeur,
        }),
      });
      setEtatCreationImmo({ statut: 'inactif' });
      setLibelleImmoSaisie('');
      setMontantImmoSaisie('');
      setDureeImmoSaisie('5');
      setValeurResiduelleImmoSaisie('0');
      setCreationImmoOuverte(false);
      boutonNouvelleImmo.current?.focus();
      chargerImmobilisations();
    } catch (erreur: unknown) {
      setEtatCreationImmo({ statut: 'erreur', message: messageErreurApi(erreur) });
    }
  }

  async function marquerEcheanceFaite(echeanceId: string): Promise<void> {
    // Capture AVANT l'aller-retour reseau : c'est l'etat affiche au moment du
    // clic qui decide de la prochaine cible, jamais un etat deja rechargé.
    const lignesAvant = etatEcheances.statut === 'pret' ? etatEcheances.lignes : [];
    try {
      await requeteApi(`/echeances/${echeanceId}/marquer-faite`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      // Continuer le pointage sans retomber sur `<body>` — voir
      // `cleEcheanceAFocaliserApresPointage` et `rechargerEcheancesEnArrierePlan`
      // ci-dessus (recette clavier du 30/07/2026).
      setCleEcheanceAFocaliser(cleEcheanceAFocaliserApresPointage(lignesAvant, echeanceId));
      rechargerEcheancesEnArrierePlan();
    } catch (erreur: unknown) {
      // CLAUDE.md §4 : jamais de catch silencieux. Ce bouton pointe une
      // échéance RÉGLEMENTAIRE (listing TVA au 31 mars, INASTI trimestriel) :
      // manquer l'échéance n'a rien de bloquant, mais CROIRE l'avoir pointée
      // fait manquer la suivante. L'ancien catch rechargeait la liste après un
      // échec : l'écran se réaffichait à l'identique et rendait l'échec
      // invisible. `etatEcheancesApresEchecPointage` est une fonction PURE
      // (voir sa définition) : il n'y a plus de rechargement possible à cet
      // endroit, silencieux ou non.
      setEtatEcheances(etatEcheancesApresEchecPointage(erreur));
    }
  }

  /**
   * Enregistre (ou efface, si `montantEstimeCents` vaut `null`) le montant
   * estimé d'une échéance. Même traitement d'échec que `marquerEcheanceFaite`
   * ci-dessus : remplacer l'échéancier par un bandeau d'erreur plutôt qu'un
   * `catch` silencieux (CLAUDE.md §4) — un échec de saisie invisible ici
   * ferait croire qu'une estimation a été enregistrée alors qu'elle ne l'a
   * pas été.
   *
   * AUCUN focus posé ici, volontairement : cette sauvegarde se déclenche au
   * `blur` (`ChampMontantEstimeEcheance`), donc APRÈS que l'utilisateur a déjà
   * quitté le champ — souvent après plusieurs `Tab`. Le focus doit simplement
   * CONTINUER SA ROUTE, jamais être ramené ici : `rechargerEcheancesEnArrierePlan`
   * suffit, elle ne démonte que la cellule dont la valeur a changé (voir sa
   * définition), jamais l'endroit où `Tab` a déjà emmené l'utilisateur.
   */
  async function enregistrerEstimationEcheance(
    echeanceId: string,
    montantEstimeCents: number | null,
  ): Promise<void> {
    try {
      await requeteApi(`/echeances/${echeanceId}/estimer-montant`, {
        method: 'POST',
        body: JSON.stringify({ montantEstimeCents }),
      });
      rechargerEcheancesEnArrierePlan();
    } catch (erreur: unknown) {
      setEtatEcheances(etatEcheancesApresEchecPointage(erreur));
    }
  }

  async function cloturerPeriodeCourante(): Promise<void> {
    const mois = Number.parseInt(aujourdHui().slice(5, 7), 10);
    // Confirmation NATIVE (donc pleinement clavier), sur le modèle de
    // `Sessions.tsx`. Sans elle, ce bouton était le seul de l'écran qui
    // verrouillait une période comptable — écriture marquante et non
    // triviale à défaire — sans motif, sans garde et sans confirmation :
    // une tabulation de trop suivie d'`Entrée` suffisait.
    const confirme = window.confirm(
      `Clôturer ${NOMS_MOIS[mois - 1]} ${anneeCourante()} ? Les écritures de ce mois seront marquées comme figées. La réouverture reste possible, mais elle exigera un motif et sera tracée.`,
    );
    if (!confirme) return;

    setEtatEcriturePeriode({ statut: 'en_cours' });
    try {
      const clotureePar = clotureeParSaisie.trim();
      await requeteApi('/periodes/cloturer', {
        method: 'POST',
        body: JSON.stringify({
          annee: anneeCourante(),
          mois,
          ...(clotureePar === '' ? {} : { clotureePar }),
        }),
      });
      setEtatEcriturePeriode({ statut: 'inactif' });
      setClotureeParSaisie('');
      chargerPeriodes();
    } catch (erreur: unknown) {
      setEtatEcriturePeriode({ statut: 'erreur', message: messageErreurApi(erreur) });
    }
  }

  async function confirmerReouverturePeriode(periodeId: string): Promise<void> {
    if (motifReouverturePeriode.trim() === '') {
      setEtatEcriturePeriode({
        statut: 'erreur',
        message: 'Indiquez pourquoi cette période est rouverte.',
      });
      return;
    }
    setEtatEcriturePeriode({ statut: 'en_cours' });
    try {
      await requeteApi(`/periodes/${periodeId}/rouvrir`, {
        method: 'POST',
        body: JSON.stringify({ motif: motifReouverturePeriode.trim() }),
      });
      setPeriodeEnReouvertureId(null);
      setMotifReouverturePeriode('');
      setEtatEcriturePeriode({ statut: 'inactif' });
      boutonCloturerPeriode.current?.focus();
      chargerPeriodes();
    } catch (erreur: unknown) {
      setEtatEcriturePeriode({ statut: 'erreur', message: messageErreurApi(erreur) });
    }
  }

  /**
   * Referme la confirmation de verrouillage SANS agir — annulation depuis le
   * bouton « Annuler », ou depuis `Échap` (voir l'écouteur clavier plus haut,
   * qui réécrit ce même geste pour ne pas ajouter cette fonction à ses
   * dépendances). `.focus()` DIRECT, sans `requestAnimationFrame` : ce n'est
   * PAS le cas « bouton désactivé qui doit se le reprendre » (D-079,
   * `boutonConfirmerVerrouillage` ci-dessous) mais celui, plus simple, du
   * panneau qui se démonte — même patron que `confirmerReouverturePeriode`
   * ci-dessus vers la même ancre.
   */
  function fermerVerrouillage(): void {
    setPeriodeEnVerrouillageId(null);
    setConfirmationVerrouillageSaisie('');
    setEtatEcritureVerrouillage({ statut: 'inactif' });
    boutonCloturerPeriode.current?.focus();
  }

  /**
   * Pose le verrou DÉFINITIF (`POST /periodes/:id/verrouiller`). Aucun motif
   * envoyé : contrairement à la réouverture, verrouiller n'est pas une
   * correction à justifier (voir le commentaire de la route côté serveur).
   *
   * SUCCÈS : la ligne quitte `'cloturee'`, donc CE bouton disparaît de la
   * ligne — D-079 tranche ce cas précis (« le focus va sur la continuation
   * naturelle du geste, `null` plutôt qu'une cible inventée s'il n'y en a
   * pas ») : `Tableau.tsx` n'expose aucune ref imperative par ligne, donc
   * aucune « continuation » propre à CETTE ligne n'existe — `boutonCloturerPeriode`
   * est l'ancre de secours déjà établie pour EXACTEMENT cette limite
   * (`confirmerReouverturePeriode` ci-dessus, même raisonnement), pas une
   * cible inventée pour l'occasion : elle est stable, toujours montée, et
   * déjà le repli du même tableau pour la même raison.
   *
   * ÉCHEC : `enCours` repasse à `false`, ce qui RÉAFFICHE le bouton de
   * confirmation — mais `disabled={enCours}` le lui a fait perdre dès le
   * clic, avant tout rendu React (le piège de focus de cette mission).
   * `requestAnimationFrame` attend le prochain rendu commité (le bouton
   * redevenu non-`disabled`) avant de le refocaliser — même remède que
   * `boutonSortir` (`Stock.tsx`) et `boutonConfirmerAnnulationRef`
   * (`DetailLot.tsx`).
   */
  async function confirmerVerrouillagePeriode(periodeId: string): Promise<void> {
    setEtatEcritureVerrouillage({ statut: 'en_cours' });
    try {
      await requeteApi(`/periodes/${periodeId}/verrouiller`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setPeriodeEnVerrouillageId(null);
      setConfirmationVerrouillageSaisie('');
      setEtatEcritureVerrouillage({ statut: 'inactif' });
      boutonCloturerPeriode.current?.focus();
      chargerPeriodes();
    } catch (erreur: unknown) {
      setEtatEcritureVerrouillage({ statut: 'erreur', message: messageErreurApi(erreur) });
      requestAnimationFrame(() => boutonConfirmerVerrouillage.current?.focus());
    }
  }

  const immobilisationSelectionnee =
    etatImmobilisations.statut === 'pret'
      ? (etatImmobilisations.lignes.find((l) => l.id === immoSelectionneeId) ?? null)
      : null;

  // Période ciblée par la confirmation de verrouillage ouverte, s'il y en a
  // une — même JOIN d'affichage que `immobilisationSelectionnee` ci-dessus,
  // aucun second calcul.
  const periodeEnVerrouillage =
    etatPeriodes.statut === 'pret'
      ? (etatPeriodes.lignes.find((l) => l.id === periodeEnVerrouillageId) ?? null)
      : null;
  const texteAttenduVerrouillage =
    periodeEnVerrouillage !== null
      ? texteConfirmationVerrouillagePeriode(
          periodeEnVerrouillage.mois,
          periodeEnVerrouillage.annee,
        )
      : '';

  const lignesEcheances =
    etatEcheances.statut === 'pret'
      ? etatEcheances.lignes.map((l) => ({
          ...l,
          onMarquerFaite: () => void marquerEcheanceFaite(l.id),
          onEstimerMontant: (montantEstimeCents: number | null) =>
            void enregistrerEstimationEcheance(l.id, montantEstimeCents),
        }))
      : [];

  return (
    <div className="flex flex-col gap-bloc">
      <div className="flex h-barre items-center justify-between">
        <h1 className="text-lg text-ink">Comptabilité</h1>
        <label className="flex items-center gap-groupe text-sm text-ink-2" htmlFor="annee-exercice">
          Exercice
          <input
            id="annee-exercice"
            type="number"
            className="num h-controle w-24 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
            value={annee}
            onChange={(e) => {
              const valeur = Number.parseInt(e.target.value, 10);
              if (Number.isInteger(valeur)) setAnnee(valeur);
            }}
          />
        </label>
      </div>

      {/* ═══ Synthèse d'exercice ═══════════════════════════════════════════ */}
      <Panneau titre={`Synthèse de l'exercice ${annee}`}>
        {etatSynthese.statut === 'chargement' && (
          <p className="text-sm text-ink-3">Calcul en cours…</p>
        )}
        {etatSynthese.statut === 'erreur' && <BandeauErreur message={etatSynthese.message} />}
        {etatSynthese.statut === 'pret' && (
          <div className="flex flex-col gap-groupe">
            <dl className="grid grid-cols-2 gap-groupe lg:grid-cols-4 text-sm">
              <div>
                <dt className="text-2xs uppercase text-ink-3">Recettes</dt>
                <dd className="num text-ink">
                  {formaterEuros(etatSynthese.synthese.recettesCents)}
                </dd>
              </div>
              <div>
                <dt className="text-2xs uppercase text-ink-3">Dépenses déductibles</dt>
                <dd className="num text-ink">
                  {formaterEuros(etatSynthese.synthese.depensesDeductiblesCents)}
                </dd>
                {/* Le defaut mesure (docs/14 §G2) etait precisement ici : ce
                    montant n'incluait ni les achats de marchandises (receptions),
                    ni les frais de session — le detail permet de verifier qu'ils
                    y sont desormais, sans dupliquer un calcul deja fait cote
                    serveur (CLAUDE.md §3 regle n°1). */}
                <p className="text-2xs text-ink-3">
                  Dépenses saisies ci-dessous + achats de marchandises (détail dans le Journal des
                  achats, frais de réception — transport, palette — compris) + frais de session.
                </p>
              </div>
              <div>
                <dt className="text-2xs uppercase text-ink-3">Amortissements</dt>
                <dd className="num text-ink">
                  {formaterEuros(etatSynthese.synthese.amortissementsCents)}
                </dd>
              </div>
              <div>
                <dt className="text-2xs uppercase text-ink-3">Bénéfice brut</dt>
                <dd className="num text-ink">
                  {formaterEuros(etatSynthese.synthese.beneficeBrutCents)}
                </dd>
              </div>
              <div>
                <dt className="text-2xs uppercase text-ink-3">Cotisations sociales estimées</dt>
                <dd className="num text-ink">
                  {formaterEuros(etatSynthese.synthese.cotisationsSocialesCents)}
                </dd>
              </div>
              <div>
                <dt className="text-2xs uppercase text-ink-3">Impôt estimé</dt>
                <dd className="num text-ink">
                  {formaterEuros(etatSynthese.synthese.impotEstimeCents)}
                </dd>
              </div>
              <div>
                <dt className="text-2xs uppercase text-ink-3">Net estimé</dt>
                <dd className="num text-lg text-ink">
                  {formaterEuros(etatSynthese.synthese.netEstimeCents)}
                </dd>
              </div>
            </dl>
            <p className="border-t border-line pt-groupe text-xs text-ink-3">
              Résultat INDICATIF. Cette application ne remplace ni un comptable, ni un guichet
              d’entreprises, ni l’AFSCA — les taux de cotisation et d’impôt appliqués sont des
              paramètres à confirmer avec votre comptable.
            </p>
          </div>
        )}
      </Panneau>

      {/* ═══ Journaux à transmettre ════════════════════════════════════════
          Juste sous la synthèse, et non dans un écran d'exports : c'est en
          lisant le résultat de l'exercice qu'on décide de l'envoyer au
          comptable. Les deux journaux suivent l'exercice choisi en tête
          d'écran — il n'y a donc aucun second sélecteur d'année à tenir
          cohérent avec le premier. */}
      <Panneau titre={`Journaux comptables ${annee}`}>
        <div className="flex flex-wrap items-start gap-bloc">
          <BoutonDocument
            chemin={`/exports/journal-recettes?annee=${annee}`}
            libelle="Journal des recettes (Excel)"
            libelleAttente="Export en cours…"
          />
          <BoutonDocument
            chemin={`/exports/journal-achats?annee=${annee}`}
            libelle="Journal des achats (Excel)"
            libelleAttente="Export en cours…"
          />
          <p className="max-w-[32rem] text-xs text-ink-3">
            Le journal des recettes est obligatoire sous franchise de TVA. Chaque édition est
            archivée avec son empreinte : deux envois successifs restent distinguables.
          </p>
        </div>
      </Panneau>

      {/* ═══ Ventes par créneau horaire ═══════════════════════════════════
          Fiche 13 (docs/17) : le créneau horaire est saisi à la clôture de
          chaque session (Sessions.tsx) et affiché ligne par ligne — jamais
          agrégé. La question posée par docs/01:238 (« les deux dernières
          heures paient-elles leur temps ? ») est une question de COMPTABILITÉ
          ANALYTIQUE (CLAUDE.md §0 : « marge par axe ») comme la marge par
          session ou par produit, pas une question de gestion d'UNE session —
          d'où sa place ici plutôt que dans Sessions.tsx. */}
      <Panneau titre={`Ventes par créneau horaire — ${annee}`} sansRembourrage>
        {etatVentesParCreneau.statut === 'chargement' && (
          <p className="px-4 py-2 text-sm text-ink-3">Chargement…</p>
        )}
        {etatVentesParCreneau.statut === 'erreur' && (
          <div className="px-4 py-2">
            <BandeauErreur message={etatVentesParCreneau.message} />
          </div>
        )}
        {etatVentesParCreneau.statut === 'pret' && (
          <>
            <Tableau
              colonnes={COLONNES_VENTES_CRENEAU}
              lignes={etatVentesParCreneau.lignes}
              cleLigne={(l) => l.creneauHoraire ?? '__non_renseigne__'}
              etatVide={
                <EtatVide
                  variante="premier-lancement"
                  titre="Aucune session clôturée cette année"
                  explication="Le CA et la marge par créneau apparaîtront ici dès qu'une session de cet exercice sera clôturée avec des créneaux saisis."
                />
              }
            />
            <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
              Cumulé sur {etatVentesParCreneau.nbSessionsCloturees} session
              {etatVentesParCreneau.nbSessionsCloturees <= 1 ? '' : 's'} clôturée
              {etatVentesParCreneau.nbSessionsCloturees <= 1 ? '' : 's'} de l’exercice. La marge est
              une ESTIMATION répartie au prorata du chiffre d’affaires de chaque créneau dans sa
              session — aucune ligne de vente ne porte de coût individuel, ce n’est donc jamais une
              décomposition réelle du coût par tranche horaire.
            </p>
          </>
        )}
      </Panneau>

      {/* ═══ Échéancier réglementaire ══════════════════════════════════════ */}
      <Panneau titre="Échéancier réglementaire" sansRembourrage>
        {etatEcheances.statut === 'chargement' && (
          <p className="px-4 py-2 text-sm text-ink-3">Chargement…</p>
        )}
        {etatEcheances.statut === 'erreur' && <BandeauErreur message={etatEcheances.message} />}
        {etatEcheances.statut === 'pret' && (
          <div ref={refListeEcheances}>
            <Tableau
              colonnes={colonnesEcheances(horizonAffichageEcheancesJours)}
              lignes={lignesEcheances}
              cleLigne={(l) => l.id}
              etatVide={<EtatVide variante="normal" texte="Aucune échéance réglementaire." />}
            />
            {lignesEcheances.length > 0 && (
              <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
                Le montant estimé est une saisie manuelle, à titre indicatif : ce n’est jamais un
                montant dû ni calculé par l’application — laissez le champ vide pour effacer une
                estimation devenue incertaine.
              </p>
            )}
          </div>
        )}
      </Panneau>

      {/* ═══ Dépenses ═══════════════════════════════════════════════════════ */}
      <Panneau titre="Dépenses" sansRembourrage>
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          {etatDepenses.statut === 'pret' ? (
            <p className="text-xs text-ink-3">
              {etatDepenses.lignes.length} ligne{etatDepenses.lignes.length <= 1 ? '' : 's'} — total{' '}
              {formaterEuros(etatDepenses.montantTotalCents)}, dont{' '}
              {formaterEuros(etatDepenses.montantDeductibleTotalCents)} déductible
              {etatDepenses.montantImmobiliseTotalCents > 0 && (
                // L'ecart entre le total et le deductible n'est pas une erreur
                // de saisie quand une immobilisation l'explique : sa deduction
                // passe par le plan d'amortissement, pas par ce journal
                // (docs/16-AUDIT-COMPTABILITE.md §4.1). HOMONYME A NE PAS
                // CONFONDRE (mission du 01/08/2026) : ce chiffre est la part
                // des DEPENSES DE CETTE PERIODE partie en immobilisation —
                // jamais la valeur totale des immobilisations elles-memes. Le
                // libelle le dit explicitement (« dont … en immobilisation »,
                // pas « valeur des immobilisations ») : ne pas le reformuler
                // sans garder cette distinction lisible a l'ecran.
                <>
                  {' '}
                  (dont {formaterEuros(etatDepenses.montantImmobiliseTotalCents)} en immobilisation,
                  déduit via le plan d’amortissement)
                </>
              )}
              .
            </p>
          ) : (
            <span />
          )}
          <button
            type="button"
            ref={boutonNouvelleDepense}
            onClick={() => setCreationDepenseOuverte((v) => !v)}
            // Bouton bascule : `aria-expanded` est le seul signal d'ouverture
            // pour un lecteur d'ecran, le libelle ne changeant pas.
            aria-expanded={creationDepenseOuverte}
            className="h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Nouvelle dépense
          </button>
        </div>

        {creationDepenseOuverte && (
          // `<form>` et non une grappe de `<div>` : sans lui, `Entrée` ne fait
          // rien et il faut aller chercher « Enregistrer » à la souris à chaque
          // dépense — or on en saisit plusieurs d'affilée (CLAUDE.md règle 10).
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void creerDepense();
            }}
            className="border-b border-line px-4 py-3"
          >
            <div className="flex flex-wrap items-end gap-bloc">
              <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="depense-date">
                Date
                <input
                  id="depense-date"
                  ref={champDateDepense}
                  type="date"
                  className="h-controle w-40 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={dateDepenseSaisie}
                  onChange={(e) => setDateDepenseSaisie(e.target.value)}
                />
              </label>
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="depense-libelle"
              >
                Libellé
                <input
                  id="depense-libelle"
                  type="text"
                  className="h-controle w-56 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={libelleDepenseSaisie}
                  onChange={(e) => setLibelleDepenseSaisie(e.target.value)}
                />
              </label>
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="depense-categorie"
              >
                Catégorie
                <select
                  id="depense-categorie"
                  className="h-controle w-40 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                  value={categorieDepenseSaisie}
                  onChange={(e) =>
                    setCategorieDepenseSaisie(e.target.value as CategorieDepenseContrat)
                  }
                >
                  {CATEGORIES_DEPENSE.map((c) => (
                    <option key={c} value={c}>
                      {LIBELLE_CATEGORIE_DEPENSE[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="depense-montant"
              >
                Montant (€)
                <input
                  id="depense-montant"
                  type="text"
                  inputMode="decimal"
                  className="num h-controle w-32 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={montantDepenseSaisie}
                  onChange={(e) => setMontantDepenseSaisie(e.target.value)}
                />
              </label>
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="depense-deductible"
              >
                Déductible (%)
                <input
                  id="depense-deductible"
                  type="text"
                  inputMode="decimal"
                  className="num h-controle w-24 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={deductibleDepenseSaisie}
                  onChange={(e) => setDeductibleDepenseSaisie(e.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={etatCreationDepense.statut === 'en_cours'}
                className="flex h-controle w-40 items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {etatCreationDepense.statut === 'en_cours' ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
            {categorieDepenseSaisie === 'matiere' && (
              // Les achats de matiere receptionnes via Stock sont DEJA comptes
              // dans la synthese (`totalAchatsMarchandisesCents`) : une saisie
              // manuelle ici avec cette categorie compterait le meme achat deux
              // fois, sans qu'aucun controle ne puisse le detecter (aucun lien
              // entre `depense` et `reception`/`lot`). Avertir au point de
              // saisie plutot que de deviner une regle metier non tranchee
              // (CLAUDE.md §7).
              <p className="mt-2 text-2xs text-ink-3">
                <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span> Un achat de matière déjà
                réceptionné dans Stock est compté automatiquement dans la synthèse d’exercice.
                N’utilisez cette catégorie que pour un achat de matière réglé hors réception (cas
                rare) — sinon il sera compté deux fois.
              </p>
            )}
            {(categorieDepenseSaisie === 'emplacement' ||
              categorieDepenseSaisie === 'carburant') && (
              // Meme risque que « matiere », sur les frais DEJA saisis a la
              // cloture de chaque session (`frais_emplacement_cents`,
              // `frais_deplacement_cents`, `frais_gaz_cents`) et desormais
              // comptes automatiquement dans la synthese d'exercice. Aucun
              // lien entre `depense` et `session_marche` ne permet de
              // detecter un doublon (packages/db/src/depots/comptabilite.ts,
              // syntheseExercice).
              <p className="mt-2 text-2xs text-ink-3">
                <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span> Le loyer d’emplacement et le
                carburant d’UNE session sont déjà comptés automatiquement dans la synthèse
                d’exercice (frais saisis à la clôture de la session). N’utilisez cette catégorie que
                pour un frais hors session (bail annuel, trajet hors marché…) — sinon il sera compté
                deux fois.
              </p>
            )}
            {categorieDepenseSaisie === 'carburant' && (
              // Nuance PROPRE au carburant, en plus de l'avertissement
              // ci-dessus : cette même catégorie alimente aussi le coût
              // kilométrique MESURÉ (fiche 13 §3.1, voie B,
              // `coutKilometriqueRetenu` dans `@batte/core`, composé par
              // `depots/lieux-rentabilite.ts`). Chaque plein RÉEL saisi ici
              // — trajet de marché ou non — y participe, même quand la même
              // somme est AUSSI reflétée dans le frais de déplacement d'une
              // session (l'avertissement ci-dessus reste valable pour la
              // synthèse d'exercice, qui est une question distincte).
              <p className="mt-2 text-2xs text-ink-3">
                Chaque plein RÉEL saisi ici alimente aussi le coût kilométrique MESURÉ (écran
                Comparaison des lieux), qui finit par primer sur le forfait officiel dès qu’il
                repose sur assez de pleins.
                {coutKilometrique !== null && ` Actuellement : ${coutKilometrique.libelle}`}
              </p>
            )}
            {categorieDepenseSaisie === 'frais_bancaires' && (
              // Meme risque, sur la commission SumUp desormais comptee
              // automatiquement (session_marche.commission_carte_cents),
              // corrigee dans syntheseExercice au meme titre que les frais de
              // session.
              <p className="mt-2 text-2xs text-ink-3">
                <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span> La commission SumUp est déjà
                comptée automatiquement dans la synthèse d’exercice (calculée à la clôture de chaque
                session). N’utilisez cette catégorie que pour un frais bancaire distinct (tenue de
                compte, carte bancaire…) — sinon elle sera comptée deux fois.
              </p>
            )}
            {etatCreationDepense.statut === 'erreur' && (
              <div className="mt-2">
                <BandeauErreur message={etatCreationDepense.message} />
              </div>
            )}
          </form>
        )}

        {etatDepenses.statut === 'chargement' && (
          <p className="px-4 py-2 text-sm text-ink-3">Chargement…</p>
        )}
        {etatDepenses.statut === 'erreur' && <BandeauErreur message={etatDepenses.message} />}
        {etatDepenses.statut === 'pret' && (
          <>
            <Tableau
              colonnes={COLONNES_DEPENSES}
              lignes={lignesDepensesAffichage}
              cleLigne={(l) => l.id}
              {...(depenseEnAnnulationId !== null
                ? { ligneSelectionneeCle: depenseEnAnnulationId }
                : {})}
              onSelectionnerLigne={(l) => {
                if (l.estAnnulee || l.estAnnulation) return;
                setDepenseEnAnnulationId((precedent) => (precedent === l.id ? null : l.id));
                setMotifAnnulationDepense('');
                setEtatAnnulationDepense({ statut: 'inactif' });
              }}
              etatVide={
                <EtatVide
                  variante="premier-lancement"
                  titre="Aucune dépense enregistrée"
                  explication="Les dépenses hors matière (loyer, assurance, matériel, formation…) apparaîtront ici. Un achat de matière déjà réceptionné dans Stock est compté automatiquement dans la synthèse : ne le saisissez pas une seconde fois ici avec la catégorie « Matière »."
                />
              }
            />
            {depenseEnAnnulationId !== null && (
              <div className="border-t border-line bg-surface-sunken px-4 py-3">
                <p className="text-sm text-ink-2">
                  Annuler cette dépense — une contre-écriture est créée, la ligne d’origine reste
                  visible.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void confirmerAnnulationDepense(depenseEnAnnulationId);
                  }}
                  className="mt-groupe flex items-end gap-groupe"
                >
                  <input
                    type="text"
                    ref={champMotifAnnulation}
                    aria-label="Motif de l’annulation"
                    placeholder="Motif de l’annulation"
                    className="h-controle flex-1 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                    value={motifAnnulationDepense}
                    onChange={(e) => setMotifAnnulationDepense(e.target.value)}
                  />
                  <button
                    type="submit"
                    disabled={etatAnnulationDepense.statut === 'en_cours'}
                    className="h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Confirmer
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDepenseEnAnnulationId(null);
                      boutonNouvelleDepense.current?.focus();
                    }}
                    className="h-controle rounded-sm border border-line-field px-3 text-sm text-ink-2 hover:bg-surface"
                  >
                    Annuler la saisie
                  </button>
                </form>
                {etatAnnulationDepense.statut === 'erreur' && (
                  <div className="mt-2">
                    <BandeauErreur message={etatAnnulationDepense.message} />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Panneau>

      {/* ═══ Immobilisations ════════════════════════════════════════════════ */}
      <Panneau titre="Immobilisations" sansRembourrage>
        <div className="flex items-center justify-end border-b border-line px-4 py-2">
          <button
            type="button"
            ref={boutonNouvelleImmo}
            onClick={() => setCreationImmoOuverte((v) => !v)}
            aria-expanded={creationImmoOuverte}
            className="h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Nouvelle immobilisation
          </button>
        </div>

        {creationImmoOuverte && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void creerImmobilisation();
            }}
            className="border-b border-line px-4 py-3"
          >
            <div className="flex flex-wrap items-end gap-bloc">
              <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="immo-libelle">
                Libellé
                <input
                  id="immo-libelle"
                  ref={champLibelleImmo}
                  type="text"
                  className="h-controle w-56 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={libelleImmoSaisie}
                  onChange={(e) => setLibelleImmoSaisie(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="immo-date">
                Acquisition
                <input
                  id="immo-date"
                  type="date"
                  className="h-controle w-40 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={dateImmoSaisie}
                  onChange={(e) => setDateImmoSaisie(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="immo-montant">
                Montant (€)
                <input
                  id="immo-montant"
                  type="text"
                  inputMode="decimal"
                  className="num h-controle w-32 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={montantImmoSaisie}
                  onChange={(e) => setMontantImmoSaisie(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="immo-duree">
                Durée (ans)
                <input
                  id="immo-duree"
                  type="text"
                  inputMode="numeric"
                  className="num h-controle w-24 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={dureeImmoSaisie}
                  onChange={(e) => setDureeImmoSaisie(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="immo-methode">
                Méthode
                <select
                  id="immo-methode"
                  className="h-controle w-36 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                  value={methodeImmoSaisie}
                  onChange={(e) =>
                    setMethodeImmoSaisie(e.target.value as MethodeAmortissementContrat)
                  }
                >
                  <option value="lineaire">Linéaire</option>
                  <option value="degressive">Dégressive</option>
                </select>
              </label>
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="immo-residuelle"
              >
                Valeur résiduelle (€)
                <input
                  id="immo-residuelle"
                  type="text"
                  inputMode="decimal"
                  className="num h-controle w-32 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={valeurResiduelleImmoSaisie}
                  onChange={(e) => setValeurResiduelleImmoSaisie(e.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={etatCreationImmo.statut === 'en_cours'}
                className="flex h-controle w-44 items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {etatCreationImmo.statut === 'en_cours' ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
            {etatCreationImmo.statut === 'erreur' && (
              <div className="mt-2">
                <BandeauErreur message={etatCreationImmo.message} />
              </div>
            )}
          </form>
        )}

        {etatImmobilisations.statut === 'chargement' && (
          <p className="px-4 py-2 text-sm text-ink-3">Chargement…</p>
        )}
        {etatImmobilisations.statut === 'erreur' && (
          <BandeauErreur message={etatImmobilisations.message} />
        )}
        {etatImmobilisations.statut === 'pret' && (
          <div className="flex flex-col items-start gap-0 lg:flex-row">
            <div className="min-w-0 flex-1 self-stretch">
              <Tableau
                colonnes={COLONNES_IMMOBILISATIONS}
                lignes={etatImmobilisations.lignes}
                cleLigne={(l) => l.id}
                {...(immoSelectionneeId !== null
                  ? { ligneSelectionneeCle: immoSelectionneeId }
                  : {})}
                onSelectionnerLigne={(l) =>
                  setImmoSelectionneeId((precedent) => (precedent === l.id ? null : l.id))
                }
                etatVide={
                  <EtatVide
                    variante="premier-lancement"
                    titre="Aucune immobilisation enregistrée"
                    explication="Le matériel amortissable (plaques, glacière, remorque…) apparaîtra ici avec son plan d’amortissement."
                  />
                }
              />
            </div>
            {immobilisationSelectionnee !== null && (
              <div className="w-full border-t border-line lg:w-[23.75rem] lg:shrink-0 lg:border-t-0 lg:border-l">
                <div className="flex items-center justify-between border-b border-line px-4 py-2">
                  <p className="text-xs font-medium text-ink">Plan d’amortissement</p>
                  <button
                    type="button"
                    onClick={() => {
                      setImmoSelectionneeId(null);
                      boutonNouvelleImmo.current?.focus();
                    }}
                    className="text-xs font-medium text-accent hover:text-accent-hover"
                  >
                    Fermer
                  </button>
                </div>
                <Tableau
                  colonnes={COLONNES_ANNUITES}
                  lignes={immobilisationSelectionnee.annuites}
                  cleLigne={(a) => String(a.exercice)}
                  etatVide={<EtatVide variante="normal" texte="Aucune annuité." />}
                />
              </div>
            )}
          </div>
        )}
      </Panneau>

      {/* ═══ Verrou de période ═════════════════════════════════════════════ */}
      <Panneau titre="Périodes" sansRembourrage>
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <p className="text-xs text-ink-3">
            La clôture d’un mois marque ses écritures comme figées ; elle ne les rend pas
            infalsifiables — une réouverture reste possible, motivée et tracée.
          </p>
          <div className="flex shrink-0 items-center gap-groupe">
            {/* Croisement avec l'écran Économies d'achat (docs/demandes/10) :
                avant de clôturer le mois courant, vérifier ce qu'il a coûté
                en achats — sans ressaisir ni le mois ni l'année. Voir
                `cheminEconomiesDuMois` pour ce que ce lien prouve et ne
                prouve pas encore côté Économies. */}
            <button
              type="button"
              onClick={() =>
                navigate(
                  cheminEconomiesDuMois(
                    anneeCourante(),
                    Number.parseInt(aujourdHui().slice(5, 7), 10),
                  ),
                )
              }
              className="h-controle rounded-sm border border-line-field px-3 text-sm text-ink-2 hover:bg-surface-sunken"
            >
              Voir l’économie d’achat de ce mois →
            </button>
            {/* `clotureePar` (voir la déclaration d'état ci-dessus) : facultatif,
                laissé vide envoie `null` — comportement identique à avant ce
                correctif. Deux personnes utilisent cette application
                (CLAUDE.md §1) : savoir laquelle a clôturé un mois précis est
                une information d'imputabilité qui manquait entièrement. */}
            <input
              type="text"
              aria-label="Clôturée par (facultatif)"
              placeholder="Clôturée par…"
              value={clotureeParSaisie}
              onChange={(e) => setClotureeParSaisie(e.target.value)}
              className="h-controle w-32 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
            />
            <button
              type="button"
              ref={boutonCloturerPeriode}
              onClick={() => void cloturerPeriodeCourante()}
              disabled={etatEcriturePeriode.statut === 'en_cours'}
              className="h-controle rounded-sm border border-line-field px-3 text-sm text-ink-2 hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-60"
            >
              Clôturer {NOMS_MOIS[Number.parseInt(aujourdHui().slice(5, 7), 10) - 1]}{' '}
              {anneeCourante()}
            </button>
          </div>
        </div>

        {etatPeriodes.statut === 'chargement' && (
          <p className="px-4 py-2 text-sm text-ink-3">Chargement…</p>
        )}
        {etatPeriodes.statut === 'erreur' && <BandeauErreur message={etatPeriodes.message} />}
        {etatPeriodes.statut === 'pret' && (
          <>
            <Tableau
              colonnes={[
                {
                  cle: 'periode',
                  libelle: 'Période',
                  largeur: '20%',
                  alignement: 'texte',
                  rendu: (l: PeriodeLigneContrat) => `${NOMS_MOIS[l.mois - 1]} ${l.annee}`,
                },
                {
                  cle: 'statut',
                  libelle: 'Statut',
                  largeur: '20%',
                  alignement: 'texte',
                  // `repli`, jamais `ellipse` (défaut) : le déclencheur du
                  // verrouillage ci-dessous a besoin d'une SECONDE ligne dans
                  // la cellule sur une période clôturée, et `ellipse` la
                  // forcerait sur une seule ligne tronquée (`white-space:
                  // nowrap`) — le bouton deviendrait invisible plutôt que
                  // simplement absent.
                  troncature: 'repli',
                  rendu: (l: PeriodeLigneContrat) => (
                    <div className="flex flex-col items-start gap-1">
                      <PastilleStatut
                        statut={statutAffichagePeriode(l.statut)}
                        libelle={LIBELLE_STATUT_PERIODE[l.statut]}
                      />
                      {/*
                       * Déclencheur du verrouillage DÉFINITIF — volontairement
                       * PAS dans la colonne « Action » à droite, à côté de
                       * « Rouvrir » : deux boutons voisins dont l'un est
                       * réversible et l'autre définitif, atteints par
                       * tabulations successives, sont un accident qui attend
                       * (mission du 01/08/2026). Ici, deux colonnes ENTIÈRES
                       * (« Clôturée le », « Motif de réouverture ») séparent
                       * visuellement les deux boutons, et leur ordre de
                       * tabulation passe par le bouton « Économies → » de
                       * chaque ligne avant d'atteindre « Rouvrir » — jamais un
                       * saut direct de l'un à l'autre. Style IDENTIQUE aux
                       * autres actions de ligne (`border-line-field`,
                       * `text-ink-2`) : la séparation vient de la POSITION,
                       * pas d'une couleur inventée pour l'occasion — voir
                       * `ImpactVerrouillagePeriode` pour où le rouge existant
                       * (`depassement`) est réellement réutilisé.
                       */}
                      {l.statut === 'cloturee' && (
                        <button
                          type="button"
                          onClick={() => {
                            setPeriodeEnReouvertureId(null);
                            setPeriodeEnVerrouillageId((precedent) =>
                              precedent === l.id ? null : l.id,
                            );
                            setConfirmationVerrouillageSaisie('');
                            setEtatEcritureVerrouillage({ statut: 'inactif' });
                          }}
                          className="h-controle rounded-sm border border-line-field px-2 text-xs text-ink-2 hover:bg-surface-sunken"
                        >
                          Verrouiller…
                        </button>
                      )}
                    </div>
                  ),
                },
                {
                  cle: 'cloture',
                  libelle: 'Clôturée le',
                  largeur: '20%',
                  alignement: 'texte',
                  // `clotureePar` (`schemaPeriodeLigne`, docs/21-CHAMPS-NON-LUS.md
                  // §1.9) : QUI a clôturé, jamais dit avant ce correctif — les
                  // deux personnes de CLAUDE.md §1 utilisent cet écran, et une
                  // clôture est une écriture qui verrouille le mois de l'autre.
                  // Repliée dans la MÊME cellule que la date plutôt qu'une
                  // colonne de plus : `null` la moitié du temps (saisie
                  // facultative), une colonne dédiée serait vide plus souvent
                  // qu'utile (docs/07 §4.4, hauteur rare, mais ici la largeur
                  // aurait été payée par les quatre autres colonnes pour rien).
                  rendu: (l: PeriodeLigneContrat) => (
                    <>
                      {ouTiret(l.dateCloture, (d) => formaterDate(d))}
                      {l.clotureePar !== null && (
                        <span className="ml-1 text-2xs text-ink-3">— {l.clotureePar}</span>
                      )}
                    </>
                  ),
                },
                {
                  cle: 'reouverture',
                  libelle: 'Motif de réouverture',
                  largeur: '20%',
                  alignement: 'texte',
                  // Le motif est la JUSTIFICATION LÉGALE de la réouverture d'une
                  // période close (docs/07 §1.4 : « un motif de contrepassation
                  // est obligatoire »). Le couper, c'est produire une piste
                  // d'audit qu'on ne peut pas lire — donc pas une piste d'audit.
                  // Texte libre, longueur non bornée : `repli`, et rien d'autre.
                  troncature: 'repli',
                  // `dateReouverture` (`schemaPeriodeLigne`, docs/21-CHAMPS-NON-LUS.md
                  // §1.9) : QUAND la réouverture a eu lieu, écrit automatiquement
                  // par le serveur à chaque réouverture (jamais `null` dès que
                  // `motifReouverture` l'est) mais jamais lu avant ce correctif —
                  // le motif était visible, sa date ne l'était pas.
                  rendu: (l: PeriodeLigneContrat) =>
                    l.motifReouverture === null
                      ? TIRET_ABSENT
                      : `${l.dateReouverture !== null ? `${formaterDate(l.dateReouverture)} — ` : ''}${l.motifReouverture}`,
                  // Plus de `titre` : il valait `''` sur toute période jamais
                  // rouverte, ce qui posait un `title=""` — une infobulle vide
                  // là où la cellule affiche « — ». Avec `repli` la valeur est
                  // entièrement rendue : l'infobulle n'a plus rien à ajouter.
                },
                {
                  cle: 'action',
                  libelle: '',
                  largeur: '20%',
                  alignement: 'texte',
                  rendu: (l: PeriodeLigneContrat) => (
                    <div className="flex items-center justify-end gap-groupe">
                      {/* Même pont que le bouton d'en-tête ci-dessus, mais pour
                          UN MOIS PASSÉ précis plutôt que le mois courant —
                          utile en revenant sur une période déjà close. */}
                      <button
                        type="button"
                        onClick={() => navigate(cheminEconomiesDuMois(l.annee, l.mois))}
                        className="h-controle rounded-sm border border-line-field px-2 text-xs text-ink-2 hover:bg-surface-sunken"
                      >
                        Économies →
                      </button>
                      {l.statut === 'cloturee' && (
                        <button
                          type="button"
                          onClick={() => {
                            // Mutuellement exclusif avec la confirmation de
                            // verrouillage (colonne « Statut ») : les deux ne
                            // doivent jamais s'afficher en même temps sous le
                            // tableau, l'une réversible, l'autre définitive.
                            setPeriodeEnVerrouillageId(null);
                            setPeriodeEnReouvertureId((precedent) =>
                              precedent === l.id ? null : l.id,
                            );
                            setMotifReouverturePeriode('');
                            setEtatEcriturePeriode({ statut: 'inactif' });
                          }}
                          className="h-controle rounded-sm border border-line-field px-2 text-xs text-ink-2 hover:bg-surface-sunken"
                        >
                          Rouvrir
                        </button>
                      )}
                    </div>
                  ),
                },
              ]}
              lignes={etatPeriodes.lignes}
              cleLigne={(l) => l.id}
              etatVide={<EtatVide variante="normal" texte="Aucune période clôturée." />}
            />
            {periodeEnReouvertureId !== null && (
              <div className="border-t border-line bg-surface-sunken px-4 py-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void confirmerReouverturePeriode(periodeEnReouvertureId);
                  }}
                  className="flex items-end gap-groupe"
                >
                  <input
                    type="text"
                    ref={champMotifReouverture}
                    aria-label="Motif de la réouverture"
                    placeholder="Motif de la réouverture"
                    className="h-controle flex-1 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                    value={motifReouverturePeriode}
                    onChange={(e) => setMotifReouverturePeriode(e.target.value)}
                  />
                  <button
                    type="submit"
                    disabled={etatEcriturePeriode.statut === 'en_cours'}
                    className="h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Confirmer
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPeriodeEnReouvertureId(null);
                      boutonCloturerPeriode.current?.focus();
                    }}
                    className="h-controle rounded-sm border border-line-field px-3 text-sm text-ink-2 hover:bg-surface"
                  >
                    Annuler la saisie
                  </button>
                </form>
                {etatEcriturePeriode.statut === 'erreur' && (
                  <div className="mt-2">
                    <BandeauErreur message={etatEcriturePeriode.message} />
                  </div>
                )}
              </div>
            )}
            {/*
             * Confirmation de verrouillage — bloc SÉPARÉ de celui de
             * réouverture ci-dessus (mutuellement exclusifs, voir les deux
             * `onClick` de la colonne « Statut »/« Action »). PAS de `<form>`
             * ici, à la différence du bloc de réouverture : `Entrée` ne doit
             * JAMAIS pouvoir déclencher un verrouillage, même depuis le champ
             * de recopie (même précaution que `BlocAnnulation.tsx`). Rien
             * n'écoute non plus `Ctrl+S` sur cet écran.
             */}
            {periodeEnVerrouillageId !== null && periodeEnVerrouillage !== null && (
              <div className="border-t border-line-strong bg-surface-sunken px-4 py-3">
                <p className="text-sm font-medium text-ink">
                  Verrouillage définitif — {NOMS_MOIS[periodeEnVerrouillage.mois - 1]}{' '}
                  {periodeEnVerrouillage.annee}
                </p>
                <div className="mt-2">
                  <ImpactVerrouillagePeriode etat={etatImpactVerrouillage} />
                </div>
                {etatImpactVerrouillage.statut === 'pret' && (
                  <div className="mt-3 flex items-end gap-groupe">
                    <div className="flex flex-1 flex-col gap-1">
                      <p className="text-xs text-ink-3">
                        Recopiez « {texteAttenduVerrouillage} » pour activer le verrouillage
                      </p>
                      <input
                        type="text"
                        ref={champConfirmationVerrouillage}
                        aria-label={`Recopier « ${texteAttenduVerrouillage} » pour confirmer le verrouillage définitif`}
                        placeholder={texteAttenduVerrouillage}
                        className="h-controle rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                        value={confirmationVerrouillageSaisie}
                        onChange={(e) => setConfirmationVerrouillageSaisie(e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      ref={boutonConfirmerVerrouillage}
                      onClick={() => void confirmerVerrouillagePeriode(periodeEnVerrouillageId)}
                      disabled={
                        etatEcritureVerrouillage.statut === 'en_cours' ||
                        !confirmationVerrouillageActivable(
                          etatImpactVerrouillage,
                          confirmationVerrouillageSaisie,
                          texteAttenduVerrouillage,
                        )
                      }
                      className="h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {etatEcritureVerrouillage.statut === 'en_cours'
                        ? 'Verrouillage…'
                        : 'Verrouiller définitivement'}
                    </button>
                    <button
                      type="button"
                      onClick={fermerVerrouillage}
                      className="h-controle rounded-sm border border-line-field px-3 text-sm text-ink-2 hover:bg-surface"
                    >
                      Annuler
                    </button>
                  </div>
                )}
                {etatImpactVerrouillage.statut === 'erreur' && (
                  <div className="mt-3">
                    <button
                      type="button"
                      ref={boutonFermerErreurVerrouillage}
                      onClick={fermerVerrouillage}
                      className="h-controle rounded-sm border border-line-field px-3 text-sm text-ink-2 hover:bg-surface"
                    >
                      Fermer
                    </button>
                  </div>
                )}
                {etatEcritureVerrouillage.statut === 'erreur' && (
                  <div className="mt-2">
                    <BandeauErreur message={etatEcritureVerrouillage.message} />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Panneau>
    </div>
  );
}
