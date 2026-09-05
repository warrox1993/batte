import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  formaterDate,
  formaterEuros,
  formaterMontant,
  formaterPointsDeBase,
  fournisseursProposables,
  GLYPHE_STATUT,
  messageDetectionEconomie,
  ouTiret,
  parserEuros,
  schemaListeConditionnements,
  schemaListeFournisseurs,
  schemaListeIngredients,
  type Conditionnement,
  type Fournisseur,
  type IngredientReferentiel,
} from '@batte/core';
import { TYPES_ACTION_ECONOMIE, type TypeActionEconomie } from '@batte/core';
import {
  schemaDetectionEconomie,
  schemaEconomieLigne,
  schemaListeEconomies,
  schemaResultatRenegociation,
  schemaTableauBordEconomies,
  type DetectionEconomieContrat,
  type EconomieLigneContrat,
  type TableauBordEconomiesContrat,
} from '@batte/core';
import { BoutonDocument } from '../composants/BoutonDocument';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { MessageErreur } from '../composants/EncartErreur';
import { ErreurApi, requeteApi } from '../lib/api';
import { aujourdHui } from '../lib/dates';

/**
 * Écran Économies d'achat (fiche
 * `docs/demandes/12-MODULE-ECONOMIES-ACHAT-INSPIRE-MITHRA.md`), sur le modèle
 * du classeur Mithra Pharmaceuticals : capturer un avant/après de prix à
 * chaque décision d'achat, l'agréger en tableau de bord.
 *
 * Règle d'architecture n°1 (CLAUDE.md §3) : cet écran n'effectue AUCUN calcul
 * métier. L'économie de chaque ligne, la ventilation mensuelle et la part de
 * marge viennent TOUTES du serveur (`calculerEconomieCents`,
 * `agregerEconomies`, `partMargeDueAuxEconomiesBp` — `packages/core/src/economies.ts`).
 * Les seules fonctions locales sont des PARSERS de saisie et des libellés
 * d'affichage, jamais une formule.
 *
 * DÉTECTION D'ÉCONOMIE (`GET /economies/detecter`, docs/21-CHAMPS-NON-LUS.md
 * §1.2) — cet écran ne l'appelait jusqu'ici JAMAIS, alors que la route existe
 * précisément « pour proposer l'écart AVANT saisie » (commentaire du contrat,
 * `schemaDetectionEconomie`, `packages/core/src/contrats/economies.ts`). Câblée ici sur le
 * formulaire « Renégocier un tarif », le seul endroit de cet écran où l'on
 * s'apprête à ENREGISTRER un nouveau prix pour un couple ingrédient/
 * fournisseur déjà identifié (le conditionnement choisi les porte tous les
 * deux).
 *
 * LE MOMENT CHOISI : à la sortie du champ « Nouveau prix » (`onBlur`), jamais
 * à chaque frappe (insupportable) ni seulement après l'enregistrement (trop
 * tard — l'argent serait déjà engagé). C'est l'instant où l'utilisateur a fini
 * de taper un montant et s'apprête à passer à la suite : le bon moment pour
 * lui dire, avant qu'il ne clique sur « Enregistrer », si ce prix est
 * meilleur ou moins bon que ce qui est déjà connu chez ce fournisseur pour cet
 * article. La détection est délibérément gardée SANS `quantiteUniteRefCandidat` :
 * le prix renégocié porte sur LE MÊME conditionnement (même contenance) que
 * celui affiché en « Prix actuel », donc une comparaison de prix TOTAUX
 * (`packages/db/src/depots/economies.ts`, « comportement historique ») reste
 * un entier de centimes lisible avec `formaterEuros` — pas un taux fractionnaire
 * au gramme, illisible pour un utilisateur qui compare à un bon de livraison.
 *
 * NE BLOQUE JAMAIS L'ENREGISTREMENT. Un prix plus élevé peut être parfaitement
 * justifié (dépannage, qualité différente, fournisseur plus proche) : le
 * message construit par `messageDetectionEconomie` (`@batte/core`) le DIT,
 * il ne l'empêche pas — voir cette fonction pour la décision d'affichage,
 * `null` (donc rien à l'écran) quand il n'y a rien à comparer.
 */

function anneeCourante(): number {
  return Number.parseInt(aujourdHui().slice(0, 4), 10);
}

/**
 * Lit `?annee=<n>` UNE SEULE FOIS, au montage — même patron que `Menus.tsx`
 * (lien Produits → Menus, `?produit=<id>`, docs/demandes/16 §211-223) : au-delà,
 * c'est l'utilisateur qui choisit l'année, jamais l'URL qui reprend la main
 * sur une sélection déjà faite à la main.
 *
 * Comble le pont posé par `Comptabilite.tsx` (`cheminEconomiesDuMois`, bouton
 * « Voir l'économie d'achat de ce mois ») : avant ce lot, cet écran n'avait
 * AUCUNE lecture de paramètre d'URL, et retombait toujours sur l'année civile
 * courante (`anneeCourante`) quel que soit le mois qu'on venait de clôturer.
 *
 * Contrairement à `produit` dans `Menus.tsx`, aucune validation contre une
 * liste chargée n'est nécessaire ici : une année est valide dès qu'elle
 * s'analyse en entier, il n'y a pas de référentiel à consulter — d'où un
 * simple `useState` paresseux plutôt que l'effet différé de `Menus.tsx`, qui
 * doit lui attendre que la liste des produits soit chargée pour vérifier que
 * l'identifiant demandé existe.
 *
 * CE QUE CE PONT NE FAIT PAS : `cheminEconomiesDuMois` pose aussi `?mois=`
 * dans l'URL, jamais lu ici. Cet écran (et les routes `GET /economies` et
 * `GET /economies/tableau-bord`, `apps/api/src/routes/economies.ts`, hors
 * zone d'écriture de cette mission) ne filtre qu'au niveau de l'ANNÉE — le
 * détail mensuel reste visible dans le graphique « Tableau de bord »
 * (`parMois`) une fois la bonne année affichée, mais sans surbrillance du mois
 * précis d'où vient le lien. Ajouter cette lecture serait un second
 * changement, hors du périmètre demandé ici (« il ne manque que la lecture »
 * de l'année).
 */
export function anneeDepuisParametreUrl(searchParams: URLSearchParams): number | null {
  const brut = searchParams.get('annee');
  if (brut === null) return null;
  const valeur = Number.parseInt(brut, 10);
  return Number.isInteger(valeur) ? valeur : null;
}

const LIBELLE_TYPE_ACTION: Readonly<Record<TypeActionEconomie, string>> = {
  negociation_prix: 'Négociation de prix',
  achat_alternatif: 'Achat alternatif',
  remplacement_stock_immobilise: 'Remplacement stock immobilisé',
  autre: 'Autre',
};

/** Jetons `--serie-1` à `--serie-4` (index.css) : rampe monochrome de
 * l'accent, seule couleur autorisée par la doctrine de design du produit. */
const COULEUR_PAR_TYPE: Readonly<Record<TypeActionEconomie, string>> = {
  negociation_prix: 'var(--serie-1)',
  achat_alternatif: 'var(--serie-2)',
  remplacement_stock_immobilise: 'var(--serie-3)',
  autre: 'var(--serie-4)',
};

/* ═══════════════════════════════════════════════════════════════════════════
   Parsing de saisie — jamais un calcul métier (même principe que
   `Comptabilite.tsx`)
   ═══════════════════════════════════════════════════════════════════════════ */

function parserEntierPositif(saisie: string): number | null {
  const nettoyee = saisie.trim();
  if (!/^\d+$/.test(nettoyee)) return null;
  const valeur = Number.parseInt(nettoyee, 10);
  return valeur > 0 ? valeur : null;
}

/**
 * Toutes les occurrences de ce bandeau dans cet écran signalent un
 * aller-retour réseau qui a échoué (chargement ou écriture), jamais une
 * alerte métier au sens du registre `depassement` — voir la même décision
 * dans `Comptabilite.tsx` (mission du 01/08/2026 sur `composants/EncartErreur.tsx`).
 */
function BandeauErreur({ message }: { message: string }) {
  return <MessageErreur message={message} />;
}

function BandeauInfo({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="border-l-2 border-conforme bg-conforme-bg px-3 py-2 text-sm text-conforme"
    >
      {message}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Colonnes du détail
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * La somme des `largeur` DOIT faire exactement 100 % (D-081, docs/05-DECISIONS.md) :
 * `Tableau.tsx` les pose sur un `<colgroup>` en `table-layout: fixed`, et si la
 * somme dépasse 100, le navigateur RENORMALISE chaque colonne à `100/somme` —
 * un rétrécissement UNIFORME et silencieux. Cette définition sommait à 108 %
 * (9+16+14+15+20+8+8+8+10), donc chaque colonne rendait à 100/108 ≈ 92,6 % de
 * sa valeur déclarée — trouvé par la garde automatique, pas par une relecture.
 *
 * La correction n'est PAS un simple retrait de 8 points : mesuré au clavier
 * (canvas `measureText` avec la police et le rembourrage réels de chaque
 * cellule, à 1280 px CSS effectifs) que les quatre colonnes NUMÉRIQUES
 * (avant/après/quantité/économie) étaient les plus courtes ALORS QUE leurs
 * en-têtes sont parmi les plus longs du tableau (« Économie (€) » ≈ 94 px
 * nécessaires contre 92,6 % de 10 % ≈ 93 px alloués avant même la
 * renormalisation — donc déjà tronqué). Un nombre ne se tronque JAMAIS
 * (docs/07-DOCTRINE-ERP-ET-DESIGN.md §4.5), contrairement à `ingredient` et
 * `fournisseur` (infobulle `titre`, troncature rattrapable) et à `type`/
 * `description` (`troncature: 'repli'`, qui absorbent le retrait en s'enroulant
 * plutôt qu'en perdant de l'information). `date` n'a pas de repli : son format
 * est de longueur FIXE (`JJ/MM/AAAA`), une largeur suffisante suffit à ne
 * jamais la tronquer, sans avoir besoin d'enroulement.
 */
const COLONNES_ECONOMIES: ReadonlyArray<ColonneTableau<EconomieLigneContrat>> = [
  {
    cle: 'date',
    libelle: 'Date',
    largeur: '10%',
    alignement: 'texte',
    rendu: (l) => formaterDate(l.dateAction),
  },
  {
    cle: 'ingredient',
    libelle: 'Ingrédient',
    largeur: '13%',
    alignement: 'texte',
    rendu: (l) => l.ingredientNom,
    titre: (l) => l.ingredientNom,
  },
  {
    cle: 'fournisseur',
    libelle: 'Fournisseur',
    largeur: '12%',
    alignement: 'texte',
    rendu: (l) => l.fournisseurNom,
    titre: (l) => l.fournisseurNom,
  },
  {
    cle: 'type',
    libelle: "Type d'action",
    largeur: '12%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (l) => LIBELLE_TYPE_ACTION[l.typeAction],
  },
  {
    cle: 'description',
    libelle: 'Description',
    largeur: '16%',
    alignement: 'texte',
    troncature: 'repli',
    // `saisiPar` / `commandeNumero` (`schemaEconomieLigne`,
    // docs/21-CHAMPS-NON-LUS.md §2.6) : jamais montrés avant ce correctif —
    // utile à deux personnes (CLAUDE.md §1) de savoir laquelle a saisi une
    // ligne, et de retrouver la commande qui l'a déclenchée. Repliés dans la
    // MÊME cellule (déjà `repli`) plutôt que deux colonnes de plus : les deux
    // sont `null` la majorité du temps (saisie facultative, ou renégociation
    // jamais rattachée à une commande), une colonne dédiée serait vide plus
    // souvent qu'utile.
    rendu: (l) => (
      <>
        {l.description}
        {(l.saisiPar !== null || l.commandeNumero !== null) && (
          <span className="block text-2xs text-ink-3">
            {[
              l.saisiPar !== null ? `saisi par ${l.saisiPar}` : null,
              l.commandeNumero !== null ? `commande ${l.commandeNumero}` : null,
            ]
              .filter((partie) => partie !== null)
              .join(' · ')}
          </span>
        )}
      </>
    ),
  },
  {
    cle: 'avant',
    libelle: 'Avant (€)',
    largeur: '9%',
    alignement: 'nombre',
    rendu: (l) => formaterMontant(l.prixUnitaireAvantCents),
  },
  {
    cle: 'apres',
    libelle: 'Après (€)',
    largeur: '9%',
    alignement: 'nombre',
    rendu: (l) => formaterMontant(l.prixUnitaireApresCents),
  },
  {
    cle: 'quantite',
    libelle: 'Quantité',
    largeur: '8%',
    alignement: 'nombre',
    rendu: (l) => String(l.quantiteConcernee),
  },
  {
    cle: 'economie',
    libelle: 'Économie (€)',
    largeur: '11%',
    alignement: 'nombre',
    rendu: (l) => formaterEuros(l.economieCents),
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   États d'écran
   ═══════════════════════════════════════════════════════════════════════════ */

type EtatTableauBord =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; tableau: TableauBordEconomiesContrat };

type EtatListe =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; lignes: EconomieLigneContrat[] };

type EtatReferentiel =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | {
      statut: 'pret';
      ingredients: IngredientReferentiel[];
      fournisseurs: Fournisseur[];
      conditionnements: Conditionnement[];
    };

type EtatEcriture =
  | { statut: 'inactif' }
  | { statut: 'en_cours' }
  | { statut: 'erreur'; message: string }
  | { statut: 'succes'; message: string };

/**
 * Détection d'économie (`GET /economies/detecter`, voir le commentaire
 * d'en-tête « DÉTECTION D'ÉCONOMIE » ci-dessus). `inactif` tant que le champ
 * prix n'a pas encore perdu le focus une première fois, ou dès que la saisie
 * change (voir `reinitialiserDetection`) : afficher un résultat périmé contre
 * un prix qu'on est en train de corriger serait pire que ne rien afficher.
 */
type EtatDetection =
  | { statut: 'inactif' }
  | { statut: 'en_cours' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; detection: DetectionEconomieContrat };

export default function Economies() {
  const [searchParams] = useSearchParams();
  // Lit `?annee=<n>` UNE SEULE FOIS (initialiseur paresseux de `useState`,
  // exécuté au premier rendu et jamais plus) : voir `anneeDepuisParametreUrl`
  // ci-dessus pour ce que ce pont prouve et ne prouve pas encore.
  const [annee, setAnnee] = useState(
    () => anneeDepuisParametreUrl(searchParams) ?? anneeCourante(),
  );

  const [etatTableauBord, setEtatTableauBord] = useState<EtatTableauBord>({ statut: 'chargement' });
  const [etatListe, setEtatListe] = useState<EtatListe>({ statut: 'chargement' });
  const [etatReferentiel, setEtatReferentiel] = useState<EtatReferentiel>({ statut: 'chargement' });

  /* ─── Renégociation de tarif — LE point d'accroche de la fiche ─────────── */
  const [renegociationOuverte, setRenegociationOuverte] = useState(false);
  const [conditionnementSaisi, setConditionnementSaisi] = useState('');
  const [prixRenegocieSaisi, setPrixRenegocieSaisi] = useState('');
  const [dateRenegociationSaisie, setDateRenegociationSaisie] = useState(aujourdHui);
  const [quantiteRenegociationSaisie, setQuantiteRenegociationSaisie] = useState('');
  const [descriptionRenegociationSaisie, setDescriptionRenegociationSaisie] = useState('');
  /**
   * `saisiPar` (`schemaRenegociationTarif`, docs/21-CHAMPS-NON-LUS.md §2.6) :
   * accepté par le contrat et le dépôt depuis le début, jamais saisi par
   * AUCUN écran — la valeur restait `null` pour toujours, quoi qu'on affiche
   * dans la liste. Facultatif : les deux personnes de CLAUDE.md §1 peuvent
   * saisir seules sans que ce soit une anomalie ; laisser vide envoie `null`,
   * comportement identique à avant ce correctif.
   */
  const [saisiParRenegociation, setSaisiParRenegociation] = useState('');
  const [etatRenegociation, setEtatRenegociation] = useState<EtatEcriture>({ statut: 'inactif' });
  const [etatDetection, setEtatDetection] = useState<EtatDetection>({ statut: 'inactif' });
  /**
   * Numéro de la dernière requête de détection lancée. Une réponse dont le
   * numéro ne correspond plus à ce compteur au moment où elle arrive est
   * PÉRIMÉE (l'utilisateur a changé le prix ou le conditionnement entre
   * temps) et doit être ignorée — sans cette garde, une réponse lente
   * pourrait écraser l'état d'une saisie plus récente.
   */
  const sequenceDetection = useRef(0);

  /* ─── Saisie libre — remplacement de stock immobilisé, achat alternatif… ── */
  const [saisieLibreOuverte, setSaisieLibreOuverte] = useState(false);
  const [ingredientSaisi, setIngredientSaisi] = useState('');
  const [fournisseurSaisi, setFournisseurSaisi] = useState('');
  const [typeActionSaisi, setTypeActionSaisi] = useState<TypeActionEconomie>(
    'remplacement_stock_immobilise',
  );
  const [descriptionLibreSaisie, setDescriptionLibreSaisie] = useState('');
  const [prixAvantSaisi, setPrixAvantSaisi] = useState('');
  const [prixApresSaisi, setPrixApresSaisi] = useState('');
  const [quantiteLibreSaisie, setQuantiteLibreSaisie] = useState('');
  const [dateLibreSaisie, setDateLibreSaisie] = useState(aujourdHui);
  /** Même champ, même raison que `saisiParRenegociation` ci-dessus. */
  const [saisiParLibre, setSaisiParLibre] = useState('');
  const [etatSaisieLibre, setEtatSaisieLibre] = useState<EtatEcriture>({ statut: 'inactif' });

  const boutonRenegociation = useRef<HTMLButtonElement>(null);
  const champConditionnement = useRef<HTMLSelectElement>(null);
  const boutonSaisieLibre = useRef<HTMLButtonElement>(null);
  const champIngredient = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (renegociationOuverte) champConditionnement.current?.focus();
  }, [renegociationOuverte]);

  useEffect(() => {
    if (saisieLibreOuverte) champIngredient.current?.focus();
  }, [saisieLibreOuverte]);

  // « Échap ferme » (docs/07 §4.6) : un seul écouteur pour les deux surfaces.
  useEffect(() => {
    function surAppuiTouche(evenement: KeyboardEvent): void {
      if (evenement.key !== 'Escape') return;
      if (renegociationOuverte) {
        setRenegociationOuverte(false);
        boutonRenegociation.current?.focus();
        return;
      }
      if (saisieLibreOuverte) {
        setSaisieLibreOuverte(false);
        boutonSaisieLibre.current?.focus();
      }
    }
    window.addEventListener('keydown', surAppuiTouche);
    return () => window.removeEventListener('keydown', surAppuiTouche);
  }, [renegociationOuverte, saisieLibreOuverte]);

  function chargerTableauBord(): void {
    setEtatTableauBord({ statut: 'chargement' });
    requeteApi<unknown>(`/economies/tableau-bord?annee=${annee}`)
      .then((reponse) =>
        setEtatTableauBord({
          statut: 'pret',
          tableau: schemaTableauBordEconomies.parse(reponse),
        }),
      )
      .catch((erreur: unknown) => {
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatTableauBord({ statut: 'erreur', message });
      });
  }

  function chargerListe(): void {
    setEtatListe({ statut: 'chargement' });
    requeteApi<unknown>(`/economies?annee=${annee}`)
      .then((reponse) =>
        setEtatListe({ statut: 'pret', lignes: schemaListeEconomies.parse(reponse).data }),
      )
      .catch((erreur: unknown) => {
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatListe({ statut: 'erreur', message });
      });
  }

  function chargerReferentiel(): void {
    setEtatReferentiel({ statut: 'chargement' });
    Promise.all([
      requeteApi<unknown>('/ingredients'),
      requeteApi<unknown>('/fournisseurs'),
      requeteApi<unknown>('/conditionnements'),
    ])
      .then(([brutIngredients, brutFournisseurs, brutConditionnements]) => {
        setEtatReferentiel({
          statut: 'pret',
          ingredients: schemaListeIngredients.parse(brutIngredients).data,
          fournisseurs: schemaListeFournisseurs.parse(brutFournisseurs).data,
          conditionnements: schemaListeConditionnements.parse(brutConditionnements).data,
        });
      })
      .catch((erreur: unknown) => {
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatReferentiel({ statut: 'erreur', message });
      });
  }

  useEffect(chargerTableauBord, [annee]);
  useEffect(chargerListe, [annee]);
  useEffect(chargerReferentiel, []);

  function reinitialiserFormulaireRenegociation(): void {
    setConditionnementSaisi('');
    setPrixRenegocieSaisi('');
    setQuantiteRenegociationSaisie('');
    setDescriptionRenegociationSaisie('');
    reinitialiserDetection();
  }

  /**
   * Invalide toute détection en vol ou déjà affichée : appelée dès que le
   * conditionnement choisi ou le prix saisi change. Un résultat de détection
   * ne vaut que pour le COUPLE (conditionnement, prix) qui l'a produit — le
   * garder affiché pendant que l'un des deux change laisserait croire à une
   * vérification qui ne porte plus sur ce qui est à l'écran.
   */
  function reinitialiserDetection(): void {
    sequenceDetection.current += 1;
    setEtatDetection({ statut: 'inactif' });
  }

  /**
   * Lance `GET /economies/detecter` pour le conditionnement et le prix
   * actuellement saisis (voir le commentaire d'en-tête « DÉTECTION
   * D'ÉCONOMIE »). Appelée À LA SORTIE du champ prix, jamais à chaque frappe.
   * Ne fait RIEN (reste `inactif`) si le conditionnement ou le prix ne sont
   * pas encore renseignés : ce n'est pas une erreur de saisie, juste un
   * formulaire pas encore assez rempli pour qu'une comparaison ait un sens.
   */
  async function verifierEconomiePotentielle(): Promise<void> {
    if (etatReferentiel.statut !== 'pret') return;
    const conditionnement = etatReferentiel.conditionnements.find(
      (c) => c.id === conditionnementSaisi,
    );
    if (conditionnement === undefined) return;

    const prixValeur = parserEuros(prixRenegocieSaisi);
    if (prixValeur === null || prixValeur < 0) return;

    // Voir la déclaration de `sequenceDetection` : une réponse dont le numéro
    // ne correspond plus à ce compteur au moment où elle arrive est périmée.
    const sequence = (sequenceDetection.current += 1);
    setEtatDetection({ statut: 'en_cours' });
    try {
      const parametres = new URLSearchParams({
        ingredientId: conditionnement.ingredientId,
        fournisseurId: conditionnement.fournisseurId,
        prixCandidatCents: String(prixValeur),
      });
      const detection = schemaDetectionEconomie.parse(
        await requeteApi<unknown>(`/economies/detecter?${parametres.toString()}`),
      );
      if (sequenceDetection.current !== sequence) return;
      setEtatDetection({ statut: 'pret', detection });
    } catch (erreur: unknown) {
      if (sequenceDetection.current !== sequence) return;
      // Ce contrôle est un CONFORT, jamais une condition d'enregistrement
      // (« ne bloque jamais ») : une panne reste visible, discrètement,
      // mais n'empêche à aucun moment de continuer à saisir.
      setEtatDetection({
        statut: 'erreur',
        message: erreur instanceof ErreurApi ? erreur.message : 'Vérification indisponible.',
      });
    }
  }

  async function soumettreRenegociation(): Promise<void> {
    if (conditionnementSaisi === '') {
      setEtatRenegociation({
        statut: 'erreur',
        message: 'Choisissez le conditionnement renégocié.',
      });
      return;
    }
    const prixValeur = parserEuros(prixRenegocieSaisi);
    if (prixValeur === null || prixValeur < 0) {
      setEtatRenegociation({
        statut: 'erreur',
        message: 'Le nouveau prix doit être un montant valide.',
      });
      return;
    }
    const quantiteValeur = parserEntierPositif(quantiteRenegociationSaisie);
    if (quantiteValeur === null) {
      setEtatRenegociation({
        statut: 'erreur',
        message: 'La quantité concernée doit être un nombre entier strictement positif.',
      });
      return;
    }
    if (etatRenegociation.statut === 'en_cours') return;

    setEtatRenegociation({ statut: 'en_cours' });
    try {
      const reponse = await requeteApi<unknown>('/economies/renegociations-tarif', {
        method: 'POST',
        body: JSON.stringify({
          conditionnementId: conditionnementSaisi,
          prixCents: prixValeur,
          datePrix: dateRenegociationSaisie,
          quantiteConcernee: quantiteValeur,
          ...(descriptionRenegociationSaisie.trim() === ''
            ? {}
            : { description: descriptionRenegociationSaisie.trim() }),
          ...(saisiParRenegociation.trim() === ''
            ? {}
            : { saisiPar: saisiParRenegociation.trim() }),
        }),
      });
      const resultat = schemaResultatRenegociation.parse(reponse);

      // `ancienPrixCents` / `nouveauPrixCents` (`schemaResultatRenegociation`,
      // docs/21-CHAMPS-NON-LUS.md §2.5) : calculés, testés, servis par
      // `POST /economies/renegociations-tarif`, jamais montrés avant ce
      // correctif — seule l'économie apparaissait, jamais l'avant/après qui
      // la justifie.
      const evolutionPrix = `${formaterEuros(resultat.ancienPrixCents)} → ${formaterEuros(resultat.nouveauPrixCents)}`;
      setEtatRenegociation({
        statut: 'succes',
        message:
          resultat.economie === null
            ? `Tarif enregistré : ${evolutionPrix}. Le nouveau prix n’étant pas inférieur à l’ancien, aucune économie n’a été créée.`
            : `Tarif enregistré : ${evolutionPrix} — économie de ${formaterEuros(resultat.economie.economieCents)} enregistrée automatiquement.`,
      });
      reinitialiserFormulaireRenegociation();
      // Renégocier plusieurs tarifs à la suite (après un même appel
      // fournisseur) est l'usage attendu de cette fiche : sans ce rappel, le
      // focus restait sur le champ qui venait d'être vidé au lieu de revenir
      // au premier champ, forçant une tabulation en arrière avant de pouvoir
      // enchaîner (même principe que `Evenements.tsx` après une création).
      champConditionnement.current?.focus();
      chargerTableauBord();
      chargerListe();
      chargerReferentiel();
    } catch (erreur: unknown) {
      const message =
        erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
      setEtatRenegociation({ statut: 'erreur', message });
    }
  }

  function reinitialiserFormulaireLibre(): void {
    setIngredientSaisi('');
    setFournisseurSaisi('');
    setDescriptionLibreSaisie('');
    setPrixAvantSaisi('');
    setPrixApresSaisi('');
    setQuantiteLibreSaisie('');
  }

  async function soumettreSaisieLibre(): Promise<void> {
    if (ingredientSaisi === '' || fournisseurSaisi === '') {
      setEtatSaisieLibre({
        statut: 'erreur',
        message: "Choisissez l'ingrédient et le fournisseur.",
      });
      return;
    }
    if (descriptionLibreSaisie.trim() === '') {
      setEtatSaisieLibre({
        statut: 'erreur',
        message: 'Décrivez l’action menée : c’est la justification de l’économie.',
      });
      return;
    }
    const avantValeur = parserEuros(prixAvantSaisi);
    const apresValeur = parserEuros(prixApresSaisi);
    if (avantValeur === null || apresValeur === null || avantValeur < 0 || apresValeur < 0) {
      setEtatSaisieLibre({
        statut: 'erreur',
        message: 'Les prix « avant » et « après » doivent être des montants valides.',
      });
      return;
    }
    if (apresValeur >= avantValeur) {
      setEtatSaisieLibre({
        statut: 'erreur',
        message: 'Le prix « après » doit être strictement inférieur au prix « avant ».',
      });
      return;
    }
    const quantiteValeur = parserEntierPositif(quantiteLibreSaisie);
    if (quantiteValeur === null) {
      setEtatSaisieLibre({
        statut: 'erreur',
        message: 'La quantité concernée doit être un nombre entier strictement positif.',
      });
      return;
    }
    if (etatSaisieLibre.statut === 'en_cours') return;

    setEtatSaisieLibre({ statut: 'en_cours' });
    try {
      const reponse = await requeteApi<unknown>('/economies', {
        method: 'POST',
        body: JSON.stringify({
          dateAction: dateLibreSaisie,
          ingredientId: ingredientSaisi,
          fournisseurId: fournisseurSaisi,
          typeAction: typeActionSaisi,
          description: descriptionLibreSaisie.trim(),
          prixUnitaireAvantCents: avantValeur,
          prixUnitaireApresCents: apresValeur,
          quantiteConcernee: quantiteValeur,
          ...(saisiParLibre.trim() === '' ? {} : { saisiPar: saisiParLibre.trim() }),
        }),
      });
      const creee = schemaEconomieLigne.parse(reponse);

      setEtatSaisieLibre({
        statut: 'succes',
        message: `Économie de ${formaterEuros(creee.economieCents)} enregistrée.`,
      });
      reinitialiserFormulaireLibre();
      // Même raison que dans `soumettreRenegociation` : plusieurs économies
      // constatées se saisissent souvent à la suite.
      champIngredient.current?.focus();
      chargerTableauBord();
      chargerListe();
    } catch (erreur: unknown) {
      const message =
        erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
      setEtatSaisieLibre({ statut: 'erreur', message });
    }
  }

  const conditionnementActif =
    etatReferentiel.statut === 'pret'
      ? (etatReferentiel.conditionnements.find((c) => c.id === conditionnementSaisi) ?? null)
      : null;

  const donneesGraphique =
    etatTableauBord.statut === 'pret'
      ? etatTableauBord.tableau.parMois.map((m) => ({
          mois: m.mois,
          ...Object.fromEntries(TYPES_ACTION_ECONOMIE.map((t) => [t, m.parType[t] / 100])),
        }))
      : [];

  const parTypeTrie =
    etatTableauBord.statut === 'pret'
      ? [...etatTableauBord.tableau.parType].sort((a, b) => b.totalCents - a.totalCents)
      : [];

  return (
    <div className="flex flex-col gap-bloc">
      <div className="flex h-barre items-center justify-between">
        <h1 className="text-lg text-ink">Économies d'achat</h1>
        <label
          className="flex items-center gap-groupe text-sm text-ink-2"
          htmlFor="annee-economies"
        >
          Année
          <input
            id="annee-economies"
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

      {/* ═══ Tableau de bord — feuille « CHART_COST REDUCTION » ═══════════ */}
      <Panneau titre={`Tableau de bord ${annee}`}>
        {etatTableauBord.statut === 'chargement' && (
          <p className="text-sm text-ink-3">Calcul en cours…</p>
        )}
        {etatTableauBord.statut === 'erreur' && <BandeauErreur message={etatTableauBord.message} />}
        {etatTableauBord.statut === 'pret' && (
          <div className="flex flex-col gap-bloc">
            <div className="flex flex-wrap items-end gap-section">
              <div>
                <p className="text-2xs uppercase text-ink-3">Économie totale cumulée</p>
                <p className="num text-left text-3xl text-ink">
                  {formaterEuros(etatTableauBord.tableau.totalCents)}
                </p>
                <p className="text-xs text-ink-3">
                  {etatTableauBord.tableau.nbActions} action
                  {etatTableauBord.tableau.nbActions <= 1 ? '' : 's'} sur l'année {annee}.
                </p>
              </div>
              <div>
                <p className="text-2xs uppercase text-ink-3">Part de la marge brute</p>
                <p className="num text-left text-lg text-ink">
                  {ouTiret(etatTableauBord.tableau.partMargeBp, (bp) => formaterPointsDeBase(bp))}
                </p>
                <p className="text-xs text-ink-3">
                  {etatTableauBord.tableau.partMargeBp === null
                    ? "Marge de l'année pas encore connue ou nulle : ratio non affichable."
                    : "Part de la marge brute des sessions clôturées attribuable aux économies d'achat."}
                </p>
              </div>
            </div>

            {etatTableauBord.tableau.parMois.length === 0 ? (
              <EtatVide
                variante="premier-lancement"
                niveauTitre="h3"
                titre="Aucune économie enregistrée cette année"
                explication="Renégociez un tarif ou saisissez une économie constatée ci-dessous : elle apparaîtra ici, ventilée par mois et par type d'action."
              />
            ) : (
              <>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={donneesGraphique}
                      margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                    >
                      <CartesianGrid stroke="var(--serie-grille)" vertical={false} />
                      <XAxis
                        dataKey="mois"
                        tick={{ fontSize: 12, fill: 'var(--color-ink-3)' }}
                        axisLine={{ stroke: 'var(--color-line-strong)' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 12, fill: 'var(--color-ink-3)' }}
                        axisLine={false}
                        tickLine={false}
                        width={48}
                      />
                      <Tooltip
                        formatter={(valeur, cle) => [
                          formaterEuros(Math.round(Number(valeur) * 100)),
                          LIBELLE_TYPE_ACTION[String(cle) as TypeActionEconomie] ?? String(cle),
                        ]}
                        contentStyle={{
                          fontSize: 12,
                          border: '1px solid var(--color-line-strong)',
                          borderRadius: 4,
                        }}
                      />
                      <Legend
                        formatter={(cle: string) => LIBELLE_TYPE_ACTION[cle as TypeActionEconomie]}
                        wrapperStyle={{ fontSize: 12 }}
                      />
                      {TYPES_ACTION_ECONOMIE.map((type) => (
                        <Bar
                          key={type}
                          dataKey={type}
                          stackId="mois"
                          fill={COULEUR_PAR_TYPE[type]}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div>
                  <h3 className="mb-1 text-2xs uppercase text-ink-3">
                    Total par type d'action — le levier le plus efficace en tête
                  </h3>
                  <Tableau
                    colonnes={[
                      {
                        cle: 'type',
                        libelle: "Type d'action",
                        largeur: '40%',
                        alignement: 'texte',
                        rendu: (t) => LIBELLE_TYPE_ACTION[t.typeAction],
                      },
                      {
                        cle: 'nb',
                        libelle: 'Actions',
                        largeur: '20%',
                        alignement: 'nombre',
                        rendu: (t) => String(t.nbActions),
                      },
                      {
                        cle: 'total',
                        libelle: 'Économie totale (€)',
                        largeur: '40%',
                        alignement: 'nombre',
                        rendu: (t) => formaterEuros(t.totalCents),
                      },
                    ]}
                    lignes={parTypeTrie}
                    cleLigne={(t) => t.typeAction}
                    etatVide={<EtatVide variante="normal" texte="Aucune économie." />}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </Panneau>

      {/* ═══ Renégocier un tarif — LE point d'accroche de la fiche ════════ */}
      <Panneau titre="Renégocier un tarif" sansRembourrage>
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <p className="text-xs text-ink-3">
            Change le prix d'un conditionnement (comme depuis Ingrédients) — et enregistre
            automatiquement l'économie si le nouveau prix est inférieur à l'ancien.
          </p>
          <button
            type="button"
            ref={boutonRenegociation}
            onClick={() => setRenegociationOuverte((v) => !v)}
            aria-expanded={renegociationOuverte}
            className="h-controle shrink-0 rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Renégocier un tarif
          </button>
        </div>

        {renegociationOuverte && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void soumettreRenegociation();
            }}
            className="border-b border-line px-4 py-3"
          >
            <div className="flex flex-wrap items-end gap-bloc">
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="renegociation-conditionnement"
              >
                Conditionnement
                <select
                  id="renegociation-conditionnement"
                  ref={champConditionnement}
                  className="h-controle w-72 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                  value={conditionnementSaisi}
                  onChange={(e) => {
                    setConditionnementSaisi(e.target.value);
                    // Le résultat déjà affiché portait sur l'ANCIEN
                    // conditionnement : il n'a plus de sens ici.
                    reinitialiserDetection();
                  }}
                >
                  <option value="">— Choisir —</option>
                  {etatReferentiel.statut === 'pret' &&
                    etatReferentiel.conditionnements
                      .filter((c) => c.actif)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.ingredientNom} — {c.libelle} ({c.fournisseurNom})
                        </option>
                      ))}
                </select>
              </label>
              {conditionnementActif !== null && (
                <p className="pb-2 text-xs text-ink-3">
                  Prix actuel : {formaterEuros(conditionnementActif.prixCents)}
                </p>
              )}
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="renegociation-prix"
              >
                Nouveau prix (€)
                <input
                  id="renegociation-prix"
                  type="text"
                  inputMode="decimal"
                  className="num h-controle w-32 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={prixRenegocieSaisi}
                  onChange={(e) => {
                    setPrixRenegocieSaisi(e.target.value);
                    // Le prix change : le dernier résultat ne porte plus sur
                    // ce qui est à l'écran, voir `reinitialiserDetection`.
                    reinitialiserDetection();
                  }}
                  // À LA SORTIE du champ, jamais à chaque frappe (voir le
                  // commentaire d'en-tête « DÉTECTION D'ÉCONOMIE »).
                  onBlur={() => void verifierEconomiePotentielle()}
                />
              </label>
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="renegociation-date"
              >
                Date
                <input
                  id="renegociation-date"
                  type="date"
                  className="h-controle w-40 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={dateRenegociationSaisie}
                  onChange={(e) => setDateRenegociationSaisie(e.target.value)}
                />
              </label>
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="renegociation-quantite"
              >
                Volume concerné
                <input
                  id="renegociation-quantite"
                  type="text"
                  inputMode="numeric"
                  className="num h-controle w-32 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={quantiteRenegociationSaisie}
                  onChange={(e) => setQuantiteRenegociationSaisie(e.target.value)}
                />
              </label>
              <label
                className="flex flex-1 flex-col gap-groupe text-sm text-ink-2"
                htmlFor="renegociation-description"
              >
                Description (facultative)
                <input
                  id="renegociation-description"
                  type="text"
                  placeholder="Justification de la négociation"
                  className="h-controle w-full rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={descriptionRenegociationSaisie}
                  onChange={(e) => setDescriptionRenegociationSaisie(e.target.value)}
                />
              </label>
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="renegociation-saisi-par"
              >
                Saisi par (facultatif)
                <input
                  id="renegociation-saisi-par"
                  type="text"
                  placeholder="Prénom"
                  className="h-controle w-32 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={saisiParRenegociation}
                  onChange={(e) => setSaisiParRenegociation(e.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={etatRenegociation.statut === 'en_cours'}
                className="flex h-controle w-40 items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {etatRenegociation.statut === 'en_cours' ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
            {/* Détection d'économie (voir le commentaire d'en-tête « DÉTECTION
                D'ÉCONOMIE ») — repère affiché à la sortie du champ prix,
                jamais bloquant : `messageDetectionEconomie` rend `null` quand
                il n'y a rien à comparer, et alors rien ne s'affiche ici. */}
            {etatDetection.statut === 'pret' &&
              messageDetectionEconomie(etatDetection.detection) !== null && (
                <p className="mt-2 text-xs text-ink-2">
                  <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span>{' '}
                  {messageDetectionEconomie(etatDetection.detection)}
                </p>
              )}
            {etatDetection.statut === 'erreur' && (
              <p className="mt-2 text-xs text-ink-3">
                Vérification du prix indisponible : {etatDetection.message}
              </p>
            )}
            {etatRenegociation.statut === 'erreur' && (
              <div className="mt-2">
                <BandeauErreur message={etatRenegociation.message} />
              </div>
            )}
            {etatRenegociation.statut === 'succes' && (
              <div className="mt-2">
                <BandeauInfo message={etatRenegociation.message} />
              </div>
            )}
          </form>
        )}
      </Panneau>

      {/* ═══ Saisie libre — le troisième type Mithra ═══════════════════════ */}
      <Panneau titre="Économie constatée hors réception" sansRembourrage>
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <p className="text-xs text-ink-3">
            Achat d'une alternative moins chère, ou réutilisation d'un excédent de stock plutôt
            qu'un nouvel achat — pertinent pour un ingrédient qui approche sa DLC.
          </p>
          <button
            type="button"
            ref={boutonSaisieLibre}
            onClick={() => setSaisieLibreOuverte((v) => !v)}
            aria-expanded={saisieLibreOuverte}
            className="h-controle shrink-0 rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Nouvelle économie
          </button>
        </div>

        {saisieLibreOuverte && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void soumettreSaisieLibre();
            }}
            className="border-b border-line px-4 py-3"
          >
            <div className="flex flex-wrap items-end gap-bloc">
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="libre-ingredient"
              >
                Ingrédient
                <select
                  id="libre-ingredient"
                  ref={champIngredient}
                  className="h-controle w-56 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                  value={ingredientSaisi}
                  onChange={(e) => setIngredientSaisi(e.target.value)}
                >
                  <option value="">— Choisir —</option>
                  {etatReferentiel.statut === 'pret' &&
                    etatReferentiel.ingredients.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.nom}
                      </option>
                    ))}
                </select>
              </label>
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="libre-fournisseur"
              >
                Fournisseur
                <select
                  id="libre-fournisseur"
                  className="h-controle w-52 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                  value={fournisseurSaisi}
                  onChange={(e) => setFournisseurSaisi(e.target.value)}
                >
                  <option value="">— Choisir —</option>
                  {/* BUG CORRIGÉ (mission « deux restes de la chaîne d'achat »,
                      31/07/2026) : ce filtre excluait déjà le fournisseur
                      SYSTÈME (« Inventaire d'ouverture », `D-049` —
                      `packages/db/src/depots/economies.ts:181` refuse toute
                      renégociation à son nom) mais oubliait `f.actif` : un
                      fournisseur DÉSACTIVÉ restait proposable pour une
                      économie neuve, alors que docs/07 §1.1 l'interdit pour
                      toute écriture. `fournisseursProposables`
                      (`@batte/core`, `packages/core/src/fournisseurs.ts`)
                      porte les deux conditions. */}
                  {etatReferentiel.statut === 'pret' &&
                    fournisseursProposables(etatReferentiel.fournisseurs).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nom}
                      </option>
                    ))}
                </select>
              </label>
              <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="libre-type">
                Type d'action
                <select
                  id="libre-type"
                  className="h-controle w-56 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                  value={typeActionSaisi}
                  onChange={(e) => setTypeActionSaisi(e.target.value as TypeActionEconomie)}
                >
                  {TYPES_ACTION_ECONOMIE.map((t) => (
                    <option key={t} value={t}>
                      {LIBELLE_TYPE_ACTION[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="libre-date">
                Date
                <input
                  id="libre-date"
                  type="date"
                  className="h-controle w-40 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={dateLibreSaisie}
                  onChange={(e) => setDateLibreSaisie(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="libre-avant">
                Prix avant (€)
                <input
                  id="libre-avant"
                  type="text"
                  inputMode="decimal"
                  className="num h-controle w-28 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={prixAvantSaisi}
                  onChange={(e) => setPrixAvantSaisi(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="libre-apres">
                Prix après (€)
                <input
                  id="libre-apres"
                  type="text"
                  inputMode="decimal"
                  className="num h-controle w-28 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={prixApresSaisi}
                  onChange={(e) => setPrixApresSaisi(e.target.value)}
                />
              </label>
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="libre-quantite"
              >
                Quantité
                <input
                  id="libre-quantite"
                  type="text"
                  inputMode="numeric"
                  className="num h-controle w-28 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={quantiteLibreSaisie}
                  onChange={(e) => setQuantiteLibreSaisie(e.target.value)}
                />
              </label>
              <label
                className="flex flex-1 basis-full flex-col gap-groupe text-sm text-ink-2"
                htmlFor="libre-description"
              >
                Description
                <input
                  id="libre-description"
                  type="text"
                  placeholder="Justification de l'économie"
                  className="h-controle w-full rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={descriptionLibreSaisie}
                  onChange={(e) => setDescriptionLibreSaisie(e.target.value)}
                />
              </label>
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="libre-saisi-par"
              >
                Saisi par (facultatif)
                <input
                  id="libre-saisi-par"
                  type="text"
                  placeholder="Prénom"
                  className="h-controle w-32 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={saisiParLibre}
                  onChange={(e) => setSaisiParLibre(e.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={etatSaisieLibre.statut === 'en_cours'}
                className="flex h-controle w-40 items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {etatSaisieLibre.statut === 'en_cours' ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
            {etatSaisieLibre.statut === 'erreur' && (
              <div className="mt-2">
                <BandeauErreur message={etatSaisieLibre.message} />
              </div>
            )}
            {etatSaisieLibre.statut === 'succes' && (
              <div className="mt-2">
                <BandeauInfo message={etatSaisieLibre.message} />
              </div>
            )}
          </form>
        )}
      </Panneau>

      {/* ═══ Détail des économies ══════════════════════════════════════════ */}
      <Panneau titre={`Détail des économies ${annee}`} sansRembourrage>
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          {etatListe.statut === 'pret' ? (
            <p className="text-xs text-ink-3">
              {etatListe.lignes.length} ligne{etatListe.lignes.length <= 1 ? '' : 's'}
            </p>
          ) : (
            <span />
          )}
          <BoutonDocument
            chemin={`/exports/economies?annee=${annee}`}
            libelle="Exporter (Excel)"
            libelleAttente="Export en cours…"
          />
        </div>
        {etatListe.statut === 'chargement' && (
          <p className="px-4 py-2 text-sm text-ink-3">Chargement…</p>
        )}
        {etatListe.statut === 'erreur' && <BandeauErreur message={etatListe.message} />}
        {etatListe.statut === 'pret' && (
          <Tableau
            colonnes={COLONNES_ECONOMIES}
            lignes={etatListe.lignes}
            cleLigne={(l) => l.id}
            etatVide={
              <EtatVide
                variante="premier-lancement"
                titre="Aucune économie enregistrée"
                explication="Renégociez un tarif ci-dessus, ou saisissez une économie constatée : chaque ligne apparaît ici avec son écart de prix et sa justification."
              />
            }
          />
        )}
      </Panneau>
    </div>
  );
}
