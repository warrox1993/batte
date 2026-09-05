import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GLYPHE_STATUT,
  LIBELLE_ECOULEMENT,
  LIBELLE_ECOULEMENT_LONG,
  RAISON_MARGE_MINUTE_REVENDU_INDISPONIBLE,
  RAISON_MARGE_MINUTE_TRANSFORME_INDISPONIBLE,
  TIRET_ABSENT,
  formaterDate,
  formaterEcartMontant,
  formaterEuros,
  formaterJoursRestants,
  estPerime,
  formaterPourcent,
  joursEntre,
  ouTiret,
  schemaEtatDemarrage,
  schemaEtatIa,
  schemaEtatStock,
  schemaListeComparaisonLieux,
  schemaListeEcheances,
  schemaListeFactures,
  schemaListeNonConformites,
  schemaListeObjectifs,
  schemaListeParametres,
  schemaListePrevisions,
  schemaListePropositionsEvenements,
  schemaListeSessions,
  schemaListeTachesEnRetard,
  schemaMouvementsPrixConcurrents,
  schemaPalmaresFournisseurs,
  schemaPalmaresProduits,
  schemaPrevision,
  schemaPrevisionCalendaire,
  schemaTableauSeuils,
  statutParPlafond,
  statutStock,
  titreEcoulement,
  trierClassementFournisseurs,
  trierClassementProduits,
  type CompteurSeuilContrat,
  type CritereFournisseurContrat,
  type CritereProduitContrat,
  type EcheanceLigneContrat,
  type EtatDemarrage,
  type EtatIa,
  type FactureResume,
  type GroupePalmaresProduitsContrat,
  type LigneClassementFournisseurContrat,
  type LigneClassementProduitContrat,
  type LigneComparaisonLieu,
  type LigneStockContrat,
  type MouvementPrixConcurrent,
  type NonConformiteContrat,
  type ObjectifLigneContrat,
  type PalmaresFournisseursContrat,
  type PalmaresProduitsContrat,
  type Parametre,
  type Prevision,
  type PrevisionArchivee,
  type PrevisionCalendaire as PrevisionCalendaireDonnees,
  type PropositionEvenement,
  type SemaineCalendaire,
  type SessionResume,
  type Statut,
  type StatutMouvementPrix,
  type TableauSeuils,
  type TacheEnRetardContrat,
} from '@batte/core';
import { EncartErreur, MessageErreur } from '../composants/EncartErreur';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { ErreurApi, requeteApi } from '../lib/api';
import { aujourdHui } from '../lib/dates';

/**
 * Tableau de bord — page d'accueil (docs/06, docs/07 mécanisme 1 : « l'application
 * DIT quoi faire »). Une seule question posée à l'écran : qu'est-ce qu'il faut
 * faire maintenant ? Sept blocs, dans l'ordre décroissant d'urgence : avant de
 * commencer (parcours de premier lancement, absent dès que la base est en
 * place), prochaine session à produire, alertes à traiter, achats à anticiper,
 * seuils légaux, dernières sessions.
 *
 * « AVANT DE COMMENCER » (`SectionDemarrage` ci-dessous) remplace la liste de
 * cases à cocher persistante que `docs/06` décrivait pour le parcours de
 * premier lancement : aucune case, aucun état stocké nulle part (correction du
 * 31/07/2026). Huit questions à réponse vraie à chaque instant
 * (`GET /api/demarrage`, `packages/db/src/depots/demarrage.ts`), jamais
 * déclarées — même doctrine que le stock (CLAUDE.md §3 règle 5) : un état
 * dérivé ne peut pas mentir. Quatre BLOQUENT une clôture, quatre FAUSSENT un
 * chiffre affiché sans rien empêcher ; les deux natures ne se mélangent
 * jamais à l'écran. Le panneau entier disparaît dès que les huit signaux sont
 * vrais, et réapparaît si l'un d'eux redevient faux.
 *
 * Doctrine appliquée (docs/07 §2.1, §2.3) :
 *  - c'est une WORKLIST, pas une liste : pas de barre de filtre, et une section
 *    entièrement vide est MASQUÉE plutôt que affichée avec « aucune alerte » ;
 *  - chaque alerte est une *cue* (§2.2) : un compte agrégé, une couleur
 *    seuillée, un clic qui mène à l'écran où la traiter ;
 *  - un seul `text-3xl` sur tout l'écran : le nombre de crêpes à produire,
 *    seul chiffre qui déclenche une action avant la prochaine session.
 *
 * Disposition en deux colonnes à partir de `lg` (docs/demandes/02) : à
 * 1440p en particulier, l'espace supplémentaire sert à montrer PLUS de blocs
 * côte à côte, jamais à agrandir des marges. Sous `lg`, tout s'empile en une
 * seule colonne — aucune information n'est perdue, seul l'ordre de lecture
 * change.
 *
 * Horizon choisi par l'utilisateur (docs/demandes/10) : UN SEUL sélecteur,
 * logé DANS le panneau « Achats à anticiper » plutôt que dans l'en-tête de
 * l'écran (revu le 31/07/2026 : un sélecteur à côté du `<h1>` se lit comme un
 * contrôle de l'écran ENTIER, alors qu'il ne gouverne que deux encarts sur
 * huit — voir la documentation de `SelecteurHorizon` ci-dessous pour le
 * raisonnement complet). Ce sélecteur gouverne les DEUX seuls encarts pour
 * lesquels un horizon en jours a un sens ET une donnée pour le vérifier :
 *  - « Achats à anticiper » réutilise tel quel `/api/prevision-calendaire`,
 *    déjà servi à l'écran « Besoins projetés » (`PrevisionCalendaire.tsx`) :
 *    aucune donnée nouvelle, un même calcul consulté depuis un second point
 *    d'entrée. Un vrai appel réseau à chaque changement d'horizon : la
 *    fenêtre est un paramètre de la PRÉVISION elle-même, recalculée côté
 *    serveur ;
 *  - la ligne « échéances » de la worklist « À traiter » est filtrée CÔTÉ
 *    ÉCRAN sur `joursAvantEcheance`, déjà chargé par `/echeances` (qui ne
 *    prend lui-même aucun paramètre de fenêtre et rend l'échéancier complet
 *    à chaque appel) : aucun rafraîchissement réseau, juste un recalcul
 *    local.
 *
 * Les AUTRES encarts (prochaine session, dernières sessions, stock sous
 * seuil actuel, DLC, tâches de nettoyage en retard, non-conformités
 * ouvertes, seuils légaux annuels) restent HORS de ce sélecteur : soit ils
 * décrivent un état PRÉSENT sans dimension « dans les prochains N jours »
 * (stock, DLC, nettoyage, non-conformités sont déjà des faits d'aujourd'hui,
 * pas des projections), soit ils sont annuels par nature (seuils légaux) ou
 * historiques (dernières sessions), soit leur fenêtre est déjà partagée avec
 * un autre écran et ne doit pas diverger d'un écran à l'autre (DLC proches :
 * même horizon que la colonne DLC de `Stock.tsx`, voir `lignesDlcProches`
 * ci-dessous). Un sélecteur qui prétendrait filtrer des alertes qu'il ne
 * recalcule pas mentirait sur ce qu'il fait — la doctrine (docs/07 §2.1)
 * l'interdit explicitement.
 *
 * Aucun calcul métier ici (CLAUDE.md §3 règle 1) : chaque nombre vient tel
 * quel de l'API. Les seules fonctions locales filtrent ou classent des lignes
 * déjà calculées (même principe que `statutLigne` dans `Stock.tsx`).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Mission « finir le tableau de bord » (01/08/2026) — six éléments demandés,
 * PAS six encarts.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * La météo et les concurrents n'ont AUCUNE ligne ici : ils vivent déjà dans
 * `ProchaineSession.tsx` (panneaux « Météo » et « Prix concurrents »,
 * mission docs/demandes/10, en place avant celle-ci), rattachés à LA session
 * qu'ils concernent — exactement le critère du porteur (« la météo n'a de
 * sens que rapportée à la session qu'elle concerne »). Le bouton « Voir le
 * détail » de `SectionPrevision` ci-dessous EST la porte d'entrée vers les
 * deux : dupliquer un second widget météo ou concurrents ici referait, sur ce
 * même écran, la faute que le porteur signale ailleurs (« une liste ne sert
 * à rien ») sans rien ajouter de nouveau à consulter.
 *
 * Le « mouvement » concurrentiel demandé explicitement par le porteur
 * (« deux concurrents ont augmenté leurs prix depuis votre dernier relevé »)
 * N'ÉTAIT PAS calculable au moment de CETTE mission : `GET /concurrents/comparateur`
 * ne rendait que le DERNIER prix relevé par produit (`dernierPrixParProduit`,
 * `packages/db/src/depots/concurrents.ts`), jamais l'avant-dernier, alors que
 * `concurrent_produit` est bien historisé (un INSERT par relevé, jamais un
 * UPDATE). Une route dédiée a depuis été posée
 * (`GET /concurrents/mouvements`, `mouvementsPrixConcurrents`,
 * `packages/db/src/depots/concurrents.ts`, mission « la case concurrents »,
 * 01/08/2026) : elle compare déjà les DEUX derniers relevés de chaque
 * produit chez chaque concurrent actif, avec la doctrine `nouveau` ≠
 * `hausse` depuis zéro écrite en tête de
 * `packages/core/src/contrats/concurrents.ts`. `SectionMouvementsConcurrents`
 * plus bas consomme cette route sans y ajouter le moindre calcul (CLAUDE.md
 * §3 règle 1) : voir sa documentation pour le détail (comptage de
 * concurrents DISTINCTS jamais de lignes produit, `stable` et `nouveau`
 * jamais confondus, aucune couleur `depassement`/`alerte` empruntée au
 * registre de statut métier — ni erreur, ni panne, ni fait de conformité de
 * cette entreprise).
 *
 * Les quatre autres tiennent SANS coûter un encart entier de plus :
 *  - le budget IA (`GET /ia/etat`) est un PIED DE PAGE discret, sous les deux
 *    colonnes (`phrasePiedBudgetIa` plus bas) — jamais un panneau, le porteur
 *    l'a explicitement demandé « discret » ;
 *  - les factures impayées rejoignent la worklist « À traiter » existante,
 *    en DEUX lignes distinctes (`facturesImpayeesEnRetard` /
 *    `facturesImpayeesSansEcheance`) parce que `facture.dateEcheance` est
 *    NULLABLE : une facture sans échéance connue n'est PAS « en retard », les
 *    confondre ferait passer une absence de donnée pour un retard confirmé,
 *    ou l'inverse (même doctrine que `dlc-perimee` / `dlc`, deux natures,
 *    deux lignes, jamais une seule ligne qui les mélange) ;
 *  - l'écart prévu/réalisé tient dans UNE colonne de plus sur « Dernières
 *    sessions » (`ecartPrevuRealisePourSession`, à partir de
 *    `GET /previsions`, déjà archivé et rapproché à la clôture — voir
 *    `packages/db/src/depots/previsions.ts:rapprocherPrevision` — jamais
 *    recalculé ici) ;
 *  - les 3 meilleurs lieux de marché (`meilleursLieux`, à partir de
 *    `GET /lieux-rentabilite`, déjà servi à l'écran « Comparaison des lieux »)
 *    forment un cinquième panneau compact, sur le même gabarit que les
 *    palmarès produits/fournisseurs. D-082 (`docs/05-DECISIONS.md`) interdit
 *    d'y faire figurer un lieu JAMAIS visité : `ComparaisonLieux.tsx` les
 *    garde visibles avec un tiret parce que c'est un outil d'ARBITRAGE
 *    complet, mais un « meilleurs lieux » qui inclurait un lieu sans
 *    historique ferait passer un chiffre INVENTÉ (le prior de baseline) pour
 *    une mesure — `meilleursLieux` exclut donc `nbSessionsRetenues === 0`
 *    ET `margeNetteAttendueCents === null` avant de prendre les trois
 *    premiers.
 */

/* Date du jour lue à chaque appel, jamais figée à l'import : voir `aujourdHui`
   dans `lib/dates.ts`. */

const CLASSE_TEXTE_STATUT: Readonly<Record<Statut, string>> = {
  depassement: 'text-depassement',
  alerte: 'text-alerte',
  conforme: 'text-conforme',
};

/* ═══════════════════════════════════════════════════════════════════════════
   Prochaine session
   ═══════════════════════════════════════════════════════════════════════════ */

type EtatPrevision =
  | { statut: 'chargement' }
  | { statut: 'aucune_session'; message: string }
  /**
   * D-082 (`docs/05-DECISIONS.md`) : zéro session close sur le lieu de la
   * prochaine session → aucune prévision, jamais un encadré d'erreur. Même
   * distinction, transposée depuis `ProchaineSession.tsx`
   * (`etatDepuisErreurPrevision`, `EtatEcran`) : « premier passage » est un
   * état NORMAL et attendu (le porteur l'a choisi, D-082), jamais une panne —
   * avant ce correctif, `/prevision` répondait `premier_passage_lieu` et ce
   * fichier n'avait aucune branche pour ce code, donc `catch` retombait sur
   * `erreur` et affichait un encadré rouge pour un fait qui n'en est pas un.
   */
  | { statut: 'premier_passage'; message: string }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; prevision: Prevision };

/**
 * Exportée pour être testée directement par rendu statique (même convention
 * que `SectionDemarrage` ci-dessous) : `TableauDeBord.test.tsx` vérifie
 * ainsi que l'état `premier_passage` (D-082) ne produit JAMAIS le balisage
 * `role="alert"`/rouge de l'état `erreur`, sans avoir à monter toute la page.
 * Ce qui exige un montage réel vit dans `TableauDeBord.montage.test.tsx`.
 */
export function SectionPrevision({
  etat,
  onVoirDetail,
  onCreerSession,
}: {
  etat: EtatPrevision;
  onVoirDetail: () => void;
  onCreerSession: () => void;
}) {
  if (etat.statut === 'chargement') {
    return <p className="text-sm text-ink-3">Calcul de la prévision…</p>;
  }

  if (etat.statut === 'aucune_session') {
    return (
      <EtatVide
        variante="premier-lancement"
        titre="Aucune session à venir"
        explication={etat.message}
        action={{ libelle: 'Créer une session', onClick: onCreerSession }}
      />
    );
  }

  /*
   * D-082 : un fait normal, pas une panne — même traitement que
   * `ProchaineSession.tsx` (`etat.statut === 'premier_passage'`), ENCADRÉ
   * INFORMATIF (`EtatVide`), jamais l'encadré rouge de la branche `erreur`
   * juste en dessous. Aucune action proposée, sur le même principe que
   * l'écran modèle : rien ne se « fait » pour sortir de cet état, il suffit
   * que la première session sur ce lieu se clôture.
   */
  if (etat.statut === 'premier_passage') {
    return (
      <EtatVide
        variante="premier-lancement"
        titre="Premier passage : aucune prévision possible"
        explication={etat.message}
      />
    );
  }

  if (etat.statut === 'erreur') {
    return <EncartErreur titre="Prochaine session" message={etat.message} />;
  }

  const { prevision } = etat;
  const { session } = prevision;

  return (
    <Panneau
      titre={
        session === null
          ? 'Prochaine session'
          : `Prochaine session — ${session.lieuNom}, ${formaterDate(session.dateSession)}`
      }
    >
      <div className="flex items-center justify-between gap-bloc">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl tabular-nums text-ink">{prevision.crepesRetenues}</span>
          <span className="text-sm text-ink-3">crêpes à produire</span>
        </div>
        <button
          type="button"
          onClick={onVoirDetail}
          // Deux boutons « Voir le détail » cohabitent sur ce tableau de bord
          // et mènent à deux écrans différents. Un lecteur d'écran qui liste
          // les boutons de la page les annoncerait à l'identique : le libellé
          // visible reste court, l'étiquette accessible dit la destination.
          aria-label="Voir le détail de la prochaine session"
          className="h-controle shrink-0 rounded-sm border border-line-field px-3 text-sm text-ink-2 hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Voir le détail
        </button>
      </div>

      {prevision.contrainteLimitante !== null && (
        <p className="mt-groupe text-sm text-alerte">
          {GLYPHE_STATUT.alerte} Ramené de {prevision.crepesRecommandees} à{' '}
          {prevision.crepesRetenues} — limite : {prevision.contrainteLimitante}.
          {prevision.manqueAGagnerCents !== null && (
            <> Manque à gagner estimé : {formaterEuros(prevision.manqueAGagnerCents)}.</>
          )}
        </p>
      )}
    </Panneau>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Avant de commencer — parcours de premier lancement (docs/06, correction du
   31/07/2026 : ÉTAT DÉRIVÉ, jamais une case à cocher persistante)
   ═══════════════════════════════════════════════════════════════════════════ */

type NatureSignalDemarrage = 'bloquant' | 'faussant';

type SignalDemarrage = {
  cle: string;
  nature: NatureSignalDemarrage;
  libelle: string;
  chemin: string;
};

export type EtatDemarrageEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; etat: EtatDemarrage };

/**
 * Catalogue des huit signaux, dans l'ordre d'affichage : les QUATRE
 * BLOQUANTS d'abord (sans cette création, `creerSession` ou
 * `cloturerSession` lève une erreur nommée — la clôture est TECHNIQUEMENT
 * impossible), puis les QUATRE qui FAUSSENT un chiffre sans rien empêcher
 * (le cas mesuré : une session se clôture avec succès et affiche pourtant un
 * coût matière à zéro et une marge brute à 100 % du CA). Les deux natures ne
 * se mélangent jamais à l'écran — voir `SectionDemarrage` plus bas.
 *
 * Dérivé en RENCONTRANT le chemin plutôt qu'en le devinant
 * (`packages/db/src/chemin-minimal-session.test.ts`), pas parce que
 * `docs/06` annonçait sept étapes : le vrai chemin en compte huit, de nature
 * différente.
 *
 * `cle` correspond EXACTEMENT à un champ de `EtatDemarrage` (`@batte/core`) :
 * `construireSignauxDemarrage` lit `etat[definition.cle]` par ce nom.
 *
 * Chaque `chemin` réutilise le pont par paramètre d'URL déjà présent dans ce
 * dépôt (`Produits.tsx` → `Menus.tsx`, `Comptabilite.tsx` → `Economies.tsx`)
 * — ici sans paramètre, un simple lien vers l'écran où combler le manque :
 * dire « il manque un ingrédient » sans lien vers l'écran des ingrédients
 * ferait faire le travail deux fois.
 */
const CATALOGUE_SIGNAUX_DEMARRAGE: ReadonlyArray<{
  cle: keyof EtatDemarrage;
  nature: NatureSignalDemarrage;
  libelle: string;
  chemin: string;
}> = [
  {
    cle: 'aLieu',
    nature: 'bloquant',
    libelle: 'Aucun lieu de marché : impossible de créer une session.',
    chemin: '/lieux',
  },
  {
    cle: 'aRecette',
    nature: 'bloquant',
    libelle: 'Aucune recette : impossible de créer un produit transformé.',
    chemin: '/recettes',
  },
  {
    cle: 'aProduitVendable',
    nature: 'bloquant',
    libelle: 'Aucun produit vendable : rien à vendre à la clôture d’une session.',
    chemin: '/produits',
  },
  {
    cle: 'aSession',
    nature: 'bloquant',
    libelle: 'Aucune session : rien à clôturer pour l’instant.',
    chemin: '/sessions',
  },
  {
    cle: 'aIngredient',
    nature: 'faussant',
    libelle: 'Aucun ingrédient : rien ne peut encore être reçu ni consommé.',
    chemin: '/ingredients',
  },
  {
    cle: 'aReception',
    nature: 'faussant',
    libelle: 'Aucune réception : le coût matière restera à zéro, quelles que soient les ventes.',
    chemin: '/stock/inventaire',
  },
  {
    cle: 'aRecetteActiveAvecLignes',
    nature: 'faussant',
    libelle: 'Aucune recette active avec des lignes : son coût théorique reste nul.',
    chemin: '/recettes',
  },
  {
    cle: 'aProductionRattacheeSession',
    nature: 'faussant',
    libelle:
      'Aucune production rattachée à une session : « crêpes produites » devra être saisi à la main, coût matière à zéro.',
    chemin: '/production',
  },
];

/**
 * Réduit l'état dérivé aux signaux ENCORE à traiter : un signal dont le champ
 * correspondant vaut déjà `true` disparaît de la liste — JAMAIS une ligne
 * « c'est fait » (docs/07 : pas de félicitation, pas de ton professoral, pas
 * d'émoji). Fonction PURE, exportée pour être testée directement, même
 * convention que `construireAlertes` ci-dessus : c'est elle qui décide si le
 * panneau existe ou non. Un tableau vide → aucun panneau, aucune hauteur.
 */
export function construireSignauxDemarrage(etat: EtatDemarrage): SignalDemarrage[] {
  return CATALOGUE_SIGNAUX_DEMARRAGE.filter((definition) => !etat[definition.cle]).map(
    (definition) => ({
      cle: definition.cle,
      nature: definition.nature,
      libelle: definition.libelle,
      chemin: definition.chemin,
    }),
  );
}

function LigneSignalDemarrage({
  signal,
  onNaviguer,
}: {
  signal: SignalDemarrage;
  onNaviguer: (chemin: string) => void;
}) {
  // Réutilise EXACTEMENT le vocabulaire visuel de statut déjà en place
  // (`Statut`, `GLYPHE_STATUT`, `CLASSE_TEXTE_STATUT`) : « bloquant » porte le
  // glyphe et la couleur de rupture, « faussant » ceux de l'alerte — aucune
  // couleur ni glyphe nouveau introduit pour ce panneau.
  const statut: Statut = signal.nature === 'bloquant' ? 'depassement' : 'alerte';
  return (
    <button
      type="button"
      onClick={() => onNaviguer(signal.chemin)}
      className="flex h-rangee w-full items-center justify-between gap-groupe border-b border-line px-4 text-left text-sm last:border-b-0 hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span
        className={`inline-flex items-center gap-groupe font-medium ${CLASSE_TEXTE_STATUT[statut]}`}
      >
        <span aria-hidden="true">{GLYPHE_STATUT[statut]}</span>
        {signal.libelle}
      </span>
      <span aria-hidden="true" className="text-ink-3">
        →
      </span>
    </button>
  );
}

/**
 * Sous-en-tête de groupe À L'INTÉRIEUR du panneau — jamais un second
 * `<Panneau>` (docs/07 §4.8 : « cartes imbriquées : profondeur maximale 1 »,
 * on sépare par un filet, pas par un panneau dans un panneau).
 */
function SousEnteteSignaux({ texte }: { texte: string }) {
  return (
    <p className="border-b border-line bg-surface-sunken px-4 py-1 text-2xs uppercase text-ink-3">
      {texte}
    </p>
  );
}

/**
 * « Avant de commencer » — disparaît TOUT SEUL dès que les huit signaux sont
 * vrais, réapparaît si l'un d'eux redevient faux (une recette qu'on
 * désactive, une réception qu'on annule…). Personne n'a à penser à le
 * fermer, parce qu'il n'y a rien à fermer : pas de case à cocher, pas d'état
 * persistant (docs/06, correction du 31/07/2026).
 *
 * Aucun indicateur de chargement : lecture SQLite locale, sous les 20 ms
 * (docs/07 §4.7, « aucun indicateur » sous ce seuil) — un panneau qui
 * clignote une fraction de seconde avant de disparaître serait pire que rien.
 */
export function SectionDemarrage({
  etat,
  onNaviguer,
}: {
  etat: EtatDemarrageEcran;
  onNaviguer: (chemin: string) => void;
}) {
  if (etat.statut === 'chargement') return null;

  // Bannière PLEINE LARGEUR dans la grille bento (mission « bento » du
  // porteur, 01/08/2026) : le wrapper de largeur ne vit QUE sur les branches
  // qui rendent réellement quelque chose — jamais sur les deux `return null`
  // ci-dessus/ci-dessous, pour que ce panneau continue à disparaître SANS
  // LAISSER LA MOINDRE TRACE (pas même une case vide dans la grille) dès que
  // les huit signaux sont vrais.
  if (etat.statut === 'erreur') {
    return (
      <div className="lg:col-span-2 2xl:col-span-12">
        <EncartErreur titre="Avant de commencer" message={etat.message} />
      </div>
    );
  }

  const signaux = construireSignauxDemarrage(etat.etat);
  if (signaux.length === 0) return null;

  const bloquants = signaux.filter((s) => s.nature === 'bloquant');
  const faussants = signaux.filter((s) => s.nature === 'faussant');

  return (
    <div className="lg:col-span-2 2xl:col-span-12">
      <Panneau titre="Avant de commencer" sansRembourrage>
        {bloquants.length > 0 && (
          <>
            <SousEnteteSignaux texte="Empêche de clôturer une session" />
            {bloquants.map((signal) => (
              <LigneSignalDemarrage key={signal.cle} signal={signal} onNaviguer={onNaviguer} />
            ))}
          </>
        )}
        {faussants.length > 0 && (
          <>
            <SousEnteteSignaux texte="Fausse les chiffres affichés" />
            {faussants.map((signal) => (
              <LigneSignalDemarrage key={signal.cle} signal={signal} onNaviguer={onNaviguer} />
            ))}
          </>
        )}
      </Panneau>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Horizon partagé — sélecteur unique, logé dans « Achats à anticiper »
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Options d'horizon du tableau de bord (docs/demandes/10) : 7, 15, 30
 * (défaut), 90 (3 mois), 180 (6 mois), 365 jours (1 an) — distinctes des
 * fenêtres « 4/12 semaines » de `PrevisionCalendaire.tsx`, qui répond à une
 * autre question (« combien produire cette semaine-là ») et non « qu'est-ce
 * qui mérite d'être préparé d'avance ».
 */
const OPTIONS_HORIZON: ReadonlyArray<{ libelle: string; jours: number }> = [
  { libelle: '7 j', jours: 7 },
  { libelle: '15 j', jours: 15 },
  { libelle: '30 j', jours: 30 },
  { libelle: '3 mois', jours: 90 },
  { libelle: '6 mois', jours: 180 },
  { libelle: '1 an', jours: 365 },
];

const HORIZON_PAR_DEFAUT = 30;

/** Libellé humain d'un horizon en jours, tel qu'affiché par le sélecteur. */
function libelleOptionHorizon(horizonJours: number): string {
  return OPTIONS_HORIZON.find((option) => option.jours === horizonJours)?.libelle ?? '';
}

/**
 * Sélecteur d'horizon — UN SEUL exemplaire, logé DANS le panneau « Achats à
 * anticiper » plutôt que dans l'en-tête de l'écran.
 *
 * Décision du 31/07/2026, revenue sur un choix antérieur. Un sélecteur posé
 * à côté du `<h1>` se lit comme un contrôle de l'écran ENTIER, alors qu'il ne
 * gouverne que deux encarts sur huit (« Achats à anticiper » et la ligne
 * « échéances » de la worklist « À traiter ») — quelqu'un qui passe de 30 à
 * 7 jours pouvait légitimement croire que les seuils légaux (annuels) ou les
 * non-conformités (sans dimension future) bougeaient aussi. C'est exactement
 * la classe de défaut que ce dépôt traque ailleurs : un chiffre juste dans un
 * cadre trompeur.
 *
 * Le vivre ICI, dans le panneau de son consommateur qui déclenche un vrai
 * appel réseau, répare ça par la POSITION plutôt que par un libellé : le
 * titre du panneau (« Achats à anticiper ») fait déjà office de portée, sans
 * coûter le moindre mot ni la moindre rangée dans l'en-tête d'écran (docs/07
 * §4.4, où la hauteur reste la ressource rare). Le second consommateur, la
 * ligne « échéances », n'a PAS sa propre copie du sélecteur — elle nomme déjà
 * son horizon dans son libellé (`construireAlertes` ci-dessous, « horizon :
 * X ») ; dupliquer le contrôle physiquement à deux endroits pour un même état
 * aurait posé la question inverse (lequel des deux fait foi ?). Aucun état de
 * « portée partielle » ni glyphe nouveau introduits : la seule chose qui a
 * changé est l'ENDROIT où vit un contrôle déjà honnête sur ce qu'il fait.
 *
 * Reste néanmoins hors de tout sous-arbre démonté conditionnellement à
 * L'INTÉRIEUR de ce panneau (premier enfant, frère des blocs
 * chargement/erreur/vide/prêt, jamais un descendant) : CLIQUER un bouton
 * d'horizon ne peut donc toujours pas faire perdre le focus (D-079,
 * `docs/05-DECISIONS.md`) — le bouton cliqué n'est jamais du côté qui se
 * redémonte.
 *
 * `data-horizon-jours` permet de RETROUVER un bouton précis depuis l'extérieur
 * (`refSelecteurHorizon` dans le composant d'écran) : c'est le cas symétrique,
 * quand un clic qui se trouve DANS le bloc « vide » de ce même panneau (le
 * bouton « Réinitialiser ») doit renvoyer le focus ICI plutôt que le laisser
 * retomber sur `<body>` — même patron que `cleEcheanceAFocaliser` dans
 * `Comptabilite.tsx`.
 */
function SelecteurHorizon({
  horizonJours,
  onChanger,
  refConteneur,
}: {
  horizonJours: number;
  onChanger: (jours: number) => void;
  refConteneur: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={refConteneur}
      className="flex flex-wrap gap-groupe"
      role="group"
      aria-label="Horizon des achats à anticiper et des échéances proches"
    >
      {OPTIONS_HORIZON.map((option) => (
        <button
          key={option.jours}
          type="button"
          data-horizon-jours={option.jours}
          onClick={() => onChanger(option.jours)}
          aria-pressed={option.jours === horizonJours}
          className={
            'h-controle shrink-0 rounded-sm border px-2 text-xs ' +
            (option.jours === horizonJours
              ? 'border-accent bg-accent text-on-accent'
              : 'border-line-field text-ink-2 hover:bg-surface-sunken')
          }
        >
          {option.libelle}
        </button>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Achats à anticiper — même donnée que « Besoins projetés », horizon partagé
   ═══════════════════════════════════════════════════════════════════════════ */

/** Résultat de `demandeProjeteeFiable` ci-dessous. */
type DemandeProjeteeFiable = {
  readonly totalCrepes: number;
  readonly nbSemainesFiables: number;
  readonly nbSemainesTotal: number;
};

type EtatAchatsAnticipes =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; nombreAlertes: number; demande: DemandeProjeteeFiable };

/**
 * Demande de crêpes PROJETÉE sur l'horizon choisi — la partie de « besoins
 * projetés » qui manquait à ce panneau (huitième élément demandé, mission
 * « finir le tableau de bord ») : `GET /prevision-calendaire` ne rend pas
 * qu'`alertesReapproPredictives` (déjà lu ci-dessous), il rend aussi
 * `semaines[].crepesPrevues` — LE besoin lui-même, en crêpes, jamais affiché
 * nulle part sur ce tableau de bord. « Combien vais-je vendre le mois
 * prochain » et « qu'est-ce que je dois commander » sont deux questions
 * distinctes ; seule la seconde y figurait.
 *
 * GARDE-FOU repris de `PrevisionCalendaire.tsx` (`SemainePanneau`,
 * `tousLesJoursExploitables`), jamais inventé ici : le CONTRAT
 * (`schemaSemaineCalendaire`, `packages/core/src/contrats/previsions.ts`)
 * promet que `crepesPrevues` exclut déjà les jours jugés inexploitables par
 * le moteur, mais le CALCUL ne le fait pas encore — sommer ce champ sans
 * vérifier `jour.exploitable` risquerait d'agréger une contribution que le
 * moteur a lui-même déclarée sans valeur. Cette fonction ne fait donc que
 * FILTRER des indicateurs déjà calculés jour par jour (même niveau que
 * `nonConformitesOuvertes` ci-dessus, aucun calcul métier nouveau,
 * CLAUDE.md §3 règle 1) avant de sommer les semaines fiables — jamais un
 * total qui se prétendrait solide alors qu'il ne l'est qu'en partie
 * (CLAUDE.md §7, « l'inconnu vaut null, jamais 0 »). `nbSemainesFiables <
 * nbSemainesTotal` doit rester VISIBLE à l'écran, pas juste au calcul.
 *
 * Exportée pour être testée directement, sans passer par le rendu de l'écran.
 */
export function demandeProjeteeFiable(
  semaines: readonly SemaineCalendaire[],
): DemandeProjeteeFiable {
  let totalCrepes = 0;
  let nbSemainesFiables = 0;
  for (const semaine of semaines) {
    if (semaine.jours.every((jour) => jour.exploitable)) {
      totalCrepes += semaine.crepesPrevues;
      nbSemainesFiables += 1;
    }
  }
  return { totalCrepes, nbSemainesFiables, nbSemainesTotal: semaines.length };
}

/**
 * Phrase de la demande projetée : trois cas, jamais un total qui tairait son
 * incomplétude. Fonction PURE, exportée pour la même raison que
 * `demandeProjeteeFiable` ci-dessus.
 */
export function phraseDemandeProjetee(
  demande: DemandeProjeteeFiable,
  libelleHorizon: string,
): string {
  if (demande.nbSemainesFiables === 0) {
    return `Demande projetée trop incertaine sur les prochains ${libelleHorizon}.`;
  }
  const base = `≈ ${demande.totalCrepes} crêpes prévues sur les prochains ${libelleHorizon}`;
  return demande.nbSemainesFiables === demande.nbSemainesTotal
    ? `${base}.`
    : `${base} (${demande.nbSemainesFiables} semaine${demande.nbSemainesFiables > 1 ? 's' : ''} ` +
        `fiable${demande.nbSemainesFiables > 1 ? 's' : ''} sur ${demande.nbSemainesTotal}).`;
}

/**
 * « Besoins projetés doit aussi être sur le tableau de bord » — ce panneau
 * EST déjà « Besoins projetés », sous un nom tourné vers l'action (« achats
 * à anticiper ») plutôt que vers la donnée : même endpoint
 * (`GET /prevision-calendaire`), même sélecteur d'horizon (7 j…1 an), et son
 * bouton menait déjà à `/prevision-calendaire` — la destination avait même
 * son nom réel dans l'`aria-label` (« … dans Besoins projetés »), mais
 * UNIQUEMENT pour un lecteur d'écran : rien de VISIBLE ne le disait. Le
 * titre du panneau porte donc désormais les deux noms.
 *
 * `demandeProjeteeFiable` ci-dessus ajoute la pièce qui manquait réellement :
 * le volume de crêpes projeté, pas seulement le compte d'ingrédients à
 * commander qui en découle.
 */
function SectionAchatsAnticipes({
  etat,
  horizonJours,
  onChangerHorizon,
  refSelecteurHorizon,
  onVoirDetail,
  onReinitialiserHorizon,
}: {
  etat: EtatAchatsAnticipes;
  horizonJours: number;
  onChangerHorizon: (jours: number) => void;
  refSelecteurHorizon: RefObject<HTMLDivElement | null>;
  onVoirDetail: () => void;
  onReinitialiserHorizon: () => void;
}) {
  const libelleHorizon = libelleOptionHorizon(horizonJours);

  return (
    <Panneau titre="Besoins projetés — achats à anticiper">
      {/* Le sélecteur vit ICI (voir sa documentation) : toujours rendu,
          jamais à l'intérieur des blocs conditionnels ci-dessous. */}
      <SelecteurHorizon
        horizonJours={horizonJours}
        onChanger={onChangerHorizon}
        refConteneur={refSelecteurHorizon}
      />

      {/* Le BESOIN lui-même (crêpes projetées), pas seulement sa conséquence
          en ingrédients à commander — voir `demandeProjeteeFiable`. Toujours
          affiché dès que l'appel a abouti, indépendamment du nombre d'alertes
          de réapprovisionnement ci-dessous : ce sont deux questions
          distinctes (« combien vais-je vendre » / « qu'est-ce que je dois
          commander »). */}
      {etat.statut === 'pret' && (
        <p className="mt-groupe text-sm text-ink-2">
          {phraseDemandeProjetee(etat.demande, libelleHorizon)}
        </p>
      )}

      <div className="mt-groupe">
        {etat.statut === 'chargement' && (
          <p className="text-sm text-ink-3">Calcul des achats à anticiper…</p>
        )}

        {etat.statut === 'erreur' && <MessageErreur message={etat.message} />}

        {/* « Vide après filtrage » (docs/07 §4.7), pas « vide normal » : ce
            panneau porte le SEUL nombre que l'horizon fait varier ici. Zéro
            alerte à 7 jours ne veut pas dire qu'il n'y a rien à préparer, ça
            veut dire qu'il n'y a rien dans CETTE fenêtre — d'où le nom de
            l'horizon dans le texte, et un bouton de réinitialisation qui
            reste dans CE panneau, juste au-dessus, sans avoir à aller
            chercher le sélecteur ailleurs sur l'écran. */}
        {etat.statut === 'pret' && etat.nombreAlertes === 0 && (
          <EtatVide
            variante="filtre"
            explicationFiltre={`Aucun achat à anticiper sur les prochains ${libelleHorizon}.`}
            onReinitialiser={onReinitialiserHorizon}
          />
        )}

        {etat.statut === 'pret' && etat.nombreAlertes > 0 && (
          <button
            type="button"
            onClick={onVoirDetail}
            aria-label="Voir le détail des achats à anticiper dans Besoins projetés"
            className="flex h-rangee w-full items-center justify-between gap-groupe rounded-sm border-b border-line px-2 text-left text-sm hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span className="inline-flex items-center gap-groupe font-medium text-alerte">
              <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span>
              {etat.nombreAlertes} ingrédient{etat.nombreAlertes > 1 ? 's' : ''} à commander
              d'avance sur les prochains {libelleHorizon}
            </span>
            <span aria-hidden="true" className="text-ink-3">
              →
            </span>
          </button>
        )}
      </div>
    </Panneau>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Alertes — worklist unique, une ligne par categorie non vide
   ═══════════════════════════════════════════════════════════════════════════ */

type LigneAlerte = {
  cle: string;
  statut: Statut;
  libelle: string;
  chemin: string;
};

/**
 * Les DONNÉES BRUTES sont conservées ici, pas les `LigneAlerte[]` déjà
 * construites : la ligne « échéances » dépend de l'horizon choisi, qui peut
 * changer SANS le moindre nouvel appel réseau (voir `echeancesDansHorizon`).
 * Si cet état stockait `lignes` directement, changer d'horizon exigerait soit
 * un rechargement complet (retour par `'chargement'`, exactement le défaut de
 * D-079), soit une resynchronisation manuelle — les deux évitables : le
 * composant recalcule `construireAlertes` à la demande via `useMemo`.
 */
type EtatAlertes =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | {
      statut: 'pret';
      stock: readonly LigneStockContrat[];
      tachesRetard: readonly TacheEnRetardContrat[];
      nonConformites: readonly NonConformiteContrat[];
      echeances: readonly EcheanceLigneContrat[];
      /**
       * Propositions d'événement découvertes par l'IA, EN ATTENTE de
       * validation humaine (`GET /evenements-decouverte/propositions`, déjà
       * triées par rentabilité prévue décroissante côté serveur —
       * `listerPropositionsEnAttente`, `packages/db/src/depots/
       * evenements-decouverte.ts`). Route posée « pour le bloc Alertes du
       * tableau de bord » (commentaire de la route elle-même,
       * `apps/api/src/routes/evenements-decouverte.ts`), jamais câblée
       * jusqu'ici : `PropositionsEvenements.tsx` calcule son propre compteur
       * local après une recherche, mais rien n'annonçait qu'il y avait
       * quelque chose À CONSULTER avant même d'ouvrir cet écran
       * (docs/28-ORPHELINS-DERIVES.md §2.5). `docs/demandes/
       * 05-EVENEMENTS-DECOUVERTE-IA-RAYON-REGLABLE.md` demande explicitement
       * cette ligne, « au même titre qu'un seuil de stock ou une échéance
       * administrative, avec sa rentabilité prévue en évidence ».
       */
      propositionsEvenements: readonly PropositionEvenement[];
      /**
       * Factures fournisseur (`GET /factures`, mission « finir le tableau de
       * bord », 01/08/2026) : alimente les deux lignes de rappel « impayée
       * en retard » / « impayée sans échéance connue » — voir
       * `facturesImpayeesEnRetard` / `facturesImpayeesSansEcheance` plus bas.
       */
      factures: readonly FactureResume[];
      /**
       * Objectifs budgétaires (`GET /objectifs`, mission « finir le tableau
       * de bord », septième élément) : alimente la ligne « objectif en
       * cours » — voir `objectifEnCoursLePlusProche` plus bas.
       */
      objectifs: readonly ObjectifLigneContrat[];
      /**
       * Horizon d'alerte DLC, lu depuis `brief_horizon_alerte_dlc_jours` —
       * voir le commentaire de `lignesDlcProches`. Chargé UNE FOIS avec le
       * reste de cet état : ce n'est pas un réglage d'écran comme
       * `horizonJours` (le sélecteur, ci-dessous), donc rien ne le fait varier
       * après coup.
       */
      horizonDlcJours: number;
    };

/** Ingrédients dont la quantité disponible est passée sous leur stock de sécurité. */
function lignesSousSeuil(lignes: readonly LigneStockContrat[]): LigneStockContrat[] {
  return lignes.filter((l) => statutStock(l.quantiteDisponible, l.stockSecurite) !== 'conforme');
}

/**
 * Ingrédients dont la DLC la plus proche tombe dans `horizonDlcJours` — lu
 * depuis `brief_horizon_alerte_dlc_jours`, jamais plus le défaut fige a 14
 * jours de `formaterJoursRestants` (correctif « brief vs écrans »,
 * 01/08/2026, docs/29-VALEURS-EN-DUR.md §4). Même paramètre, même fenêtre que
 * la colonne DLC de `Stock.tsx` ET que le brief avant-marché
 * (`apps/api/src/routes/previsions.ts`) : les trois répondent désormais à la
 * même question avec le même chiffre, au lieu de deux défauts différents (14
 * contre 7) qui pouvaient déclarer un même lot « proche » ici et « hors
 * fenêtre » sur le document imprimé le samedi soir.
 */
function lignesDlcProches(
  lignes: readonly LigneStockContrat[],
  horizonDlcJours: number,
): LigneStockContrat[] {
  const jour = aujourdHui();
  return lignes.filter(
    (l) =>
      l.dlcLaPlusProche !== null &&
      // DÉJÀ périmé ne veut pas dire « proche » : voir `lignesPerimees` ci-dessous.
      !estPerime(l.dlcLaPlusProche, jour) &&
      formaterJoursRestants(l.dlcLaPlusProche, jour, horizonDlcJours) !== null,
  );
}

/**
 * Ingrédients dont le lot le plus ancien est DÉJÀ périmé.
 *
 * Séparé de `lignesDlcProches` le 30/07/2026, et la nuance vaut d'être écrite
 * parce qu'elle a failli partir dans le mauvais sens.
 *
 * `formaterJoursRestants` n'a pas de borne basse : elle rend `J+208` pour un lot
 * périmé depuis sept mois. Le filtre ci-dessus, qui ne testait que « résultat
 * non nul », comptait donc ce lot parmi les lots « proches de leur DLC » — un
 * libellé faux sur une denrée alimentaire.
 *
 * Le correctif évident — exclure les lots périmés du filtre — aurait été PIRE
 * que le défaut : rien d'autre sur ce tableau de bord ne signale un lot périmé
 * (vérifié : le mot n'y apparaissait nulle part), donc le seul signal existant
 * aurait disparu en silence. Un lot périmé est plus urgent qu'un lot qui
 * approche, pas moins.
 *
 * D'où deux alertes distinctes : celle-ci en `depassement`, l'autre en `alerte`.
 */
function lignesPerimees(lignes: readonly LigneStockContrat[]): LigneStockContrat[] {
  const jour = aujourdHui();
  return lignes.filter((l) => l.dlcLaPlusProche !== null && estPerime(l.dlcLaPlusProche, jour));
}

/**
 * Échéances déjà en retard (quel que soit l'horizon — un retard ne redevient
 * pas « loin » parce qu'on réduit la fenêtre), ou dont l'échéance tombe dans
 * l'horizon CHOISI par l'utilisateur.
 *
 * Distincte de `alerteProche` (le champ que rend `/echeances`, calculé côté
 * serveur depuis le paramètre `echeance_horizon_alerte_jours` — une fenêtre
 * FIXE, celle qu'utilise encore `Comptabilite.tsx`). Ici, la fenêtre est
 * celle du sélecteur du tableau de bord, filtrée CÔTÉ ÉCRAN sur
 * `joursAvantEcheance` : `/echeances` n'accepte aucun paramètre et rend déjà
 * l'échéancier complet, donc élargir ou réduire l'horizon ne redéclenche
 * aucun appel réseau — contrairement à « Achats à anticiper ». Les deux
 * fenêtres (celle-ci et `alerteProche`) peuvent légitimement diverger :
 * c'est exactement le but d'un horizon choisi par l'utilisateur.
 */
export function echeancesDansHorizon(
  lignes: readonly EcheanceLigneContrat[],
  horizonJours: number,
): EcheanceLigneContrat[] {
  return lignes.filter(
    (e) =>
      e.statut === 'en_retard' || (e.statut === 'a_venir' && e.joursAvantEcheance <= horizonJours),
  );
}

/**
 * Valeur ENTIERE en vigueur d'un parametre du catalogue, a partir d'une
 * reponse deja validee de `GET /parametres`. Dupliquee depuis `Stock.tsx`/
 * `Production.tsx` (meme resolution que `regrouperParCle` dans
 * `Parametres.tsx`) : aucun fichier hors `apps/web/src/pages/**` n'est dans la
 * zone d'ecriture de cette mission — a redescendre dans `apps/web/src/lib/`
 * des que cette contrainte se leve. Rend `null` si la cle est absente : mieux
 * vaut un horizon silencieusement absent qu'une valeur inventee.
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

function nonConformitesOuvertes(lignes: readonly NonConformiteContrat[]): NonConformiteContrat[] {
  return lignes.filter((n) => n.dateResolution === null);
}

/**
 * Factures impayées dont l'échéance CONNUE est déjà dépassée.
 *
 * « Impayée » = statut autre que `payee`, et pas une annulation
 * (`estAnnulee`) : une facture annulée par contre-écriture (CLAUDE.md §3
 * règle 7) n'est plus une dette réelle, la compter ferait doublon avec
 * l'écriture qui l'a remplacée.
 *
 * Ne retient QUE les échéances déjà dépassées, jamais celles encore à venir :
 * une facture impayée dont l'échéance tombe dans trois mois n'a rien à faire
 * dans une worklist qui liste ce qu'il faut TRAITER aujourd'hui (docs/07
 * §2.6, « une variation attendue et récurrente » reste silencieuse).
 */
function facturesImpayeesEnRetard(factures: readonly FactureResume[]): FactureResume[] {
  const jour = aujourdHui();
  return factures.filter(
    (f) =>
      f.statut !== 'payee' && !f.estAnnulee && f.dateEcheance !== null && f.dateEcheance < jour,
  );
}

/**
 * Factures impayées SANS échéance connue — catégorie DISTINCTE de la
 * précédente, jamais fusionnée avec elle.
 *
 * `facture.dateEcheance` est nullable (`packages/core/src/contrats/
 * factures.ts`) : une facture sans échéance saisie n'est pas « en retard »,
 * elle est « sans échéance connue » — les confondre ferait passer une simple
 * absence de donnée pour un retard confirmé (ou l'inverse, taire une facture
 * qu'on ne sait pas dater). Même doctrine que `lignesPerimees` /
 * `lignesDlcProches` ci-dessus : deux natures, deux lignes.
 */
function facturesImpayeesSansEcheance(factures: readonly FactureResume[]): FactureResume[] {
  return factures.filter((f) => f.statut !== 'payee' && !f.estAnnulee && f.dateEcheance === null);
}

/**
 * Libellé de grandeur d'objectif — copié mot pour mot depuis
 * `LIBELLE_GRANDEUR_OBJECTIF` (`Objectifs.tsx`), DUPLIQUÉ à dessein (même
 * raison que `formaterRentabiliteProposition` plus haut) : `Objectifs.tsx`
 * est hors de la zone d'écriture de cette mission, et c'est une règle de
 * PRÉSENTATION locale à deux écrans, pas un calcul métier partagé. Même
 * quatre libellés, aucun mot changé.
 */
const LIBELLE_GRANDEUR_OBJECTIF_TABLEAU_DE_BORD: Readonly<
  Record<ObjectifLigneContrat['grandeur'], string>
> = {
  chiffre_affaires: 'Chiffre d’affaires',
  marge_nette: 'Marge nette',
  nombre_sessions: 'Nombre de sessions',
  cout_matiere_par_crepe: 'Coût matière par crêpe',
};

/** Une seule grandeur (`nombre_sessions`) se compte en unités, les trois
 * autres en centimes (CLAUDE.md §3 règle 3) — même règle que
 * `formaterValeurGrandeur` (`Objectifs.tsx`), dupliquée pour la même raison. */
function formaterValeurGrandeurObjectifTableauDeBord(
  grandeur: ObjectifLigneContrat['grandeur'],
  valeur: number,
): string {
  if (grandeur === 'nombre_sessions') return `${valeur} session${valeur > 1 ? 's' : ''}`;
  return formaterEuros(valeur);
}

/**
 * L'objectif budgétaire EN COURS le plus proche de son échéance (septième
 * élément demandé, mission « finir le tableau de bord ») — parmi les trois
 * pistes soumises par le porteur (objectif en cours / prochain succès de
 * série / dernier succès débloqué), celle-ci retenue : « ce qui mérite la
 * place est ce qui change ce qu'on fait », et un objectif budgétaire chiffre
 * directement une décision (« il reste X € à faire avant le Y »), plus
 * concrètement qu'un palier de série gamifié.
 *
 * FILTRE, ne calcule rien (CLAUDE.md §3 règle 1) : `evaluation.statut` vient
 * tel quel de `evaluerObjectif` (`packages/core/src/objectifs.ts`). `'manque'`
 * (période terminée, cible ratée) et `'atteint'` (fait acquis) sont EXCLUS —
 * aucun des deux n'attend plus d'action. `'sans_donnee'` (statut DISTINCT de
 * `'manque'`, CLAUDE.md §7 : une valeur inconnue n'est jamais un échec) est
 * exclu aussi : un objectif qu'on ne peut pas encore évaluer n'est pas une
 * cible à poursuivre AUJOURD'HUI. Seul `'en_cours'` reste. Exclut aussi les
 * annulations et les objectifs annulés (même garde que pour les factures).
 *
 * Exportée pour être testée directement (CLAUDE.md §7).
 */
export function objectifEnCoursLePlusProche(
  objectifs: readonly ObjectifLigneContrat[],
): ObjectifLigneContrat | null {
  const enCours = objectifs.filter(
    (o) => o.evaluation.statut === 'en_cours' && !o.estAnnule && !o.estAnnulation,
  );
  if (enCours.length === 0) return null;
  return enCours.reduce((lePlusProche, o) => (o.dateFin < lePlusProche.dateFin ? o : lePlusProche));
}

/**
 * Libellé de la ligne « objectif en cours » — `evaluation.ecart` est déjà
 * signé « dans le sens qui compte » par `evaluerObjectif` (positif = en
 * bonne voie) : un objectif `'en_cours'` a TOUJOURS un écart négatif (sinon
 * son statut serait `'atteint'`), donc `-ecart` est TOUJOURS le reste à
 * faire, jamais une valeur inventée — un simple changement de signe pour
 * l'affichage (même famille que `formaterEcartMontant`/`formaterEcartPourcent`
 * dans `packages/core/src/affichage.ts`), pas un second calcul.
 */
export function libelleObjectifEnCours(objectif: ObjectifLigneContrat): string {
  const { evaluation } = objectif;
  const grandeurLibelle = LIBELLE_GRANDEUR_OBJECTIF_TABLEAU_DE_BORD[objectif.grandeur];
  const resteAFaire =
    evaluation.ecart === null
      ? null
      : formaterValeurGrandeurObjectifTableauDeBord(objectif.grandeur, Math.abs(evaluation.ecart));
  const avancement =
    evaluation.avancementBp === null ? null : formaterPourcent(evaluation.avancementBp);
  const detail =
    resteAFaire !== null && avancement !== null
      ? ` — ${avancement} atteint, ${resteAFaire} restant avant le ${formaterDate(objectif.dateFin)}`
      : ` — échéance le ${formaterDate(objectif.dateFin)}`;
  return `Objectif « ${grandeurLibelle} » en cours${detail}`;
}

/**
 * Assemble la worklist : une ligne par catégorie non vide, dans l'ordre
 * d'urgence opérationnelle donné à la construction de cet écran (stock, DLC,
 * nettoyage, non-conformités, échéances, factures impayées, objectif en
 * cours).
 *
 * Exportée pour être testée directement, même convention que `statutSeuil`
 * ci-dessous : ce qu'elle produit est ce que le porteur lit en ouvrant
 * l'application, et l'ordre de gravité y est une décision métier, pas un détail
 * de rendu.
 *
 * `horizonJours` (celui du sélecteur, docs/demandes/10) ne gouverne QUE la
 * ligne « échéances » (voir `echeancesDansHorizon` ci-dessus). `horizonDlcJours`
 * (celui de `brief_horizon_alerte_dlc_jours`) ne gouverne QUE la ligne « dlc » —
 * deux fenêtres indépendantes, pour deux catégories distinctes ; les autres
 * (stock, nettoyage, non-conformités, factures) décrivent un état présent,
 * sans dimension temporelle à filtrer.
 */
export function construireAlertes(
  stock: readonly LigneStockContrat[],
  tachesRetard: readonly TacheEnRetardContrat[],
  nonConformites: readonly NonConformiteContrat[],
  echeances: readonly EcheanceLigneContrat[],
  propositionsEvenements: readonly PropositionEvenement[],
  factures: readonly FactureResume[],
  objectifs: readonly ObjectifLigneContrat[],
  horizonJours: number,
  horizonDlcJours: number,
): LigneAlerte[] {
  const lignes: LigneAlerte[] = [];

  const sousSeuil = lignesSousSeuil(stock);
  if (sousSeuil.length > 0) {
    const rupture = sousSeuil.some(
      (l) => statutStock(l.quantiteDisponible, l.stockSecurite) === 'depassement',
    );
    lignes.push({
      cle: 'stock',
      statut: rupture ? 'depassement' : 'alerte',
      libelle: `${sousSeuil.length} ingrédient${sousSeuil.length > 1 ? 's' : ''} sous le seuil de sécurité`,
      chemin: '/stock',
    });
  }

  // Les périmés d'abord, et en `depassement` : c'est plus grave qu'une DLC qui
  // approche, et cela se retire de la vente au lieu de s'écouler en priorité.
  const perimes = lignesPerimees(stock);
  if (perimes.length > 0) {
    lignes.push({
      cle: 'dlc-perimee',
      statut: 'depassement',
      libelle: `${perimes.length} ingrédient${perimes.length > 1 ? 's' : ''} avec un lot DÉJÀ périmé`,
      chemin: '/stock',
    });
  }

  const dlcProches = lignesDlcProches(stock, horizonDlcJours);
  if (dlcProches.length > 0) {
    lignes.push({
      cle: 'dlc',
      statut: 'alerte',
      // La fenêtre figure dans le libellé, même doctrine que la ligne
      // « échéances » ci-dessous : un chiffre sans sa fenêtre est
      // incomparable — et c'est exactement la phrase du brief avant-marché
      // (« Lots à moins de N jours de leur DLC »).
      libelle: `${dlcProches.length} ingrédient${dlcProches.length > 1 ? 's' : ''} avec un lot à moins de ${horizonDlcJours} jour${horizonDlcJours > 1 ? 's' : ''} de sa DLC`,
      chemin: '/stock',
    });
  }

  if (tachesRetard.length > 0) {
    lignes.push({
      cle: 'nettoyage',
      statut: 'depassement',
      libelle: `${tachesRetard.length} tâche${tachesRetard.length > 1 ? 's' : ''} de nettoyage en retard`,
      chemin: '/registre-afsca',
    });
  }

  const ouvertes = nonConformitesOuvertes(nonConformites);
  if (ouvertes.length > 0) {
    lignes.push({
      cle: 'non-conformites',
      statut: 'depassement',
      libelle: `${ouvertes.length} non-conformité${ouvertes.length > 1 ? 's' : ''} ouverte${ouvertes.length > 1 ? 's' : ''}`,
      chemin: '/registre-afsca',
    });
  }

  const proches = echeancesDansHorizon(echeances, horizonJours);
  if (proches.length > 0) {
    const enRetard = proches.some((e) => e.statut === 'en_retard');
    lignes.push({
      cle: 'echeances',
      statut: enRetard ? 'depassement' : 'alerte',
      // L'horizon figure dans le libellé : le compte varie avec le
      // sélecteur, contrairement aux autres lignes de cette worklist — le
      // taire ferait croire à un chiffre fixe qui a changé tout seul.
      libelle: `${proches.length} échéance${proches.length > 1 ? 's' : ''} réglementaire${proches.length > 1 ? 's' : ''} en retard ou proche${proches.length > 1 ? 's' : ''} (horizon : ${libelleOptionHorizon(horizonJours)})`,
      chemin: '/comptabilite',
    });
  }

  // Rappel de facturation (mission « finir le tableau de bord », 01/08/2026) :
  // DEUX lignes, jamais une seule qui mélangerait « en retard » (fait confirmé,
  // `depassement`) et « sans échéance connue » (fait incomplet, `alerte`) —
  // voir la documentation des deux fonctions ci-dessus.
  const enRetard = facturesImpayeesEnRetard(factures);
  if (enRetard.length > 0) {
    const montantCents = enRetard.reduce((somme, f) => somme + f.montantTotalCents, 0);
    lignes.push({
      cle: 'factures-retard',
      statut: 'depassement',
      libelle: `${enRetard.length} facture${enRetard.length > 1 ? 's' : ''} impayée${enRetard.length > 1 ? 's' : ''} en retard (${formaterEuros(montantCents)})`,
      chemin: '/factures',
    });
  }

  const sansEcheance = facturesImpayeesSansEcheance(factures);
  if (sansEcheance.length > 0) {
    lignes.push({
      cle: 'factures-echeance-inconnue',
      statut: 'alerte',
      libelle: `${sansEcheance.length} facture${sansEcheance.length > 1 ? 's' : ''} impayée${sansEcheance.length > 1 ? 's' : ''} sans échéance connue`,
      chemin: '/factures',
    });
  }

  // Objectif budgétaire EN COURS le plus proche de son échéance (mission
  // « finir le tableau de bord », septième élément) : `alerte`, jamais
  // `depassement` — un objectif encore poursuivable n'est pas un fait
  // dépassé, même très proche de sa fin. Même statut que `Objectifs.tsx`
  // (`CLASSE_STATUT_OBJECTIF.en_cours`), rien inventé.
  const objectifProche = objectifEnCoursLePlusProche(objectifs);
  if (objectifProche !== null) {
    lignes.push({
      cle: 'objectif-en-cours',
      statut: 'alerte',
      libelle: libelleObjectifEnCours(objectifProche),
      chemin: '/objectifs',
    });
  }

  // Dernière de la worklist, délibérément : ce n'est ni un risque de sécurité
  // alimentaire ni une échéance légale, c'est une opportunité commerciale qui
  // attend un arbitrage humain — la seule catégorie de cet écran qui n'a rien
  // à perdre à être traitée en dernier.
  if (propositionsEvenements.length > 0) {
    // Déjà triées par rentabilité DÉCROISSANTE côté serveur
    // (`listerPropositionsEnAttente`) : la première est la plus rentable.
    const meilleure = propositionsEvenements[0]!;
    lignes.push({
      cle: 'propositions-evenements',
      statut: 'alerte',
      libelle: `${propositionsEvenements.length} proposition${propositionsEvenements.length > 1 ? 's' : ''} d'événement en attente de validation (jusqu'à ${formaterRentabiliteProposition(meilleure.rentabiliteEstimeeCents)} prévus)`,
      chemin: '/evenements-decouverte',
    });
  }

  return lignes;
}

/**
 * Signe explicite sur un écart d'argent (docs/07 §4.5) — même convention que
 * `formaterRentabilite` dans `PropositionsEvenements.tsx` (dupliquée ici à
 * dessein : c'est une règle de PRÉSENTATION locale à deux écrans, pas un
 * calcul métier partagé qui mériterait de vivre dans `@batte/core`).
 */
function formaterRentabiliteProposition(cents: number): string {
  return cents >= 0 ? `+${formaterEuros(cents)}` : `−${formaterEuros(Math.abs(cents))}`;
}

function LigneAlerteBouton({
  ligne,
  onNaviguer,
}: {
  ligne: LigneAlerte;
  onNaviguer: (chemin: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onNaviguer(ligne.chemin)}
      className="flex h-rangee w-full items-center justify-between gap-groupe border-b border-line px-4 text-left text-sm last:border-b-0 hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span
        className={`inline-flex items-center gap-groupe font-medium ${CLASSE_TEXTE_STATUT[ligne.statut]}`}
      >
        <span aria-hidden="true">{GLYPHE_STATUT[ligne.statut]}</span>
        {ligne.libelle}
      </span>
      <span aria-hidden="true" className="text-ink-3">
        →
      </span>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Seuils légaux
   ═══════════════════════════════════════════════════════════════════════════ */

type EtatSeuils =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; tableau: TableauSeuils };

/**
 * Statut d'un compteur de seuil légal : le pire des deux signaux.
 *
 * L'écran ne rendait que « dépassement » ou « conforme », d'après la seule
 * projection. Conséquence mesurée : à **21 250 €, soit 85 % du seuil de
 * franchise TVA**, la ligne s'affichait **en vert** — alors que CLAUDE.md §6
 * demande une alerte à 80 % et qu'il ne restait que 3 750 € avant la sortie de
 * franchise. `statutParPlafond` existait dans `@batte/core`, testée, et n'était
 * appelée nulle part.
 *
 * Les deux signaux sont gardés parce qu'ils ne disent pas la même chose :
 * `statutParPlafond` regarde le **réalisé** (où j'en suis), la projection
 * regarde la **trajectoire** (où je vais). On peut être à 40 % du seuil et le
 * franchir avant décembre ; on peut être à 85 % en décembre sans risque. Un
 * seul des deux laisserait passer la moitié des cas.
 */
export function statutSeuil(seuil: CompteurSeuilContrat, seuilAlerteBp: number): Statut {
  const surLeRealise = statutParPlafond(seuil.realiseCents, seuil.plafondCents, seuilAlerteBp);
  if (surLeRealise === 'depassement' || seuil.depassementProjete) return 'depassement';
  return surLeRealise;
}

export function LigneSeuil({
  seuil,
  seuilAlerteBp,
}: {
  seuil: CompteurSeuilContrat;
  seuilAlerteBp: number;
}) {
  const statut: Statut = statutSeuil(seuil, seuilAlerteBp);
  return (
    <div className="flex h-rangee items-center justify-between border-b border-line px-4 text-sm last:border-b-0">
      <span className="text-ink-2">{seuil.libelle}</span>
      <span className="flex items-center gap-groupe">
        {/* Second ETAGE du MEME seuil (docs/07 §6.6) : `toleranceE604b` ne
            vaut jamais que sur la ligne « Franchise TVA » (`null` partout
            ailleurs). Placee EN LIGNE, a cote du pourcentage qu'elle
            qualifie, jamais en rangee separee — deux rangees auraient laisse
            croire a deux regles distinctes. La rangee reste a hauteur fixe
            (`h-rangee`) : contrairement au tableau de detail de
            `Sessions.tsx`, ce widget compact ne peut pas grandir sur deux
            lignes, d'ou ce texte court plutot qu'un empilement. */}
        {seuil.toleranceE604b !== null && (
          <span
            className={`text-2xs tabular-nums ${CLASSE_TEXTE_STATUT[seuil.toleranceE604b.statut]}`}
          >
            <span aria-hidden="true">{GLYPHE_STATUT[seuil.toleranceE604b.statut]}</span> tolérance{' '}
            {formaterEuros(seuil.toleranceE604b.plafondCents)}
          </span>
        )}
        <span
          className={`inline-flex items-center gap-groupe font-medium tabular-nums ${CLASSE_TEXTE_STATUT[statut]}`}
        >
          <span aria-hidden="true">{GLYPHE_STATUT[statut]}</span>
          {formaterPourcent(seuil.partBp)}
        </span>
      </span>
    </div>
  );
}

// Wrapper de largeur bento (`2xl:col-span-6`) posé UNIQUEMENT sur les
// branches qui rendent réellement un panneau : jamais sur le `return null`
// (aucun seuil paramétré), pour que cette section continue à disparaître
// sans laisser de case vide dans la grille.
function SectionSeuils({ etat, onVoirDetail }: { etat: EtatSeuils; onVoirDetail: () => void }) {
  if (etat.statut === 'chargement') {
    return (
      <div className="2xl:col-span-6">
        <Panneau titre="Seuils légaux">
          <p className="text-sm text-ink-3">Chargement des seuils…</p>
        </Panneau>
      </div>
    );
  }

  if (etat.statut === 'erreur') {
    return (
      <div className="2xl:col-span-6">
        <EncartErreur titre="Seuils légaux" message={etat.message} />
      </div>
    );
  }

  // Aucun seuil paramétré n'est un cas de configuration incomplète, pas une
  // absence d'alerte : la section reste masquée, elle ne mentirait sinon en
  // laissant croire qu'un contrôle a eu lieu.
  if (etat.tableau.data.length === 0) return null;

  const { meta } = etat.tableau;

  return (
    <div className="2xl:col-span-6">
      <Panneau titre="Seuils légaux" sansRembourrage>
        {etat.tableau.data.map((seuil) => (
          <LigneSeuil
            key={seuil.cle}
            seuil={seuil}
            seuilAlerteBp={etat.tableau.meta.seuilAlerteBp}
          />
        ))}
        <p className="flex items-center justify-between px-4 py-2 text-xs text-ink-3">
          <span>
            Dont revente : {formaterEuros(meta.caRevenduCents)} (
            {formaterPourcent(meta.partRevenduBp)}) sur {meta.sessionsTenues} session
            {meta.sessionsTenues > 1 ? 's' : ''} en {meta.annee}.
          </span>
          <button
            type="button"
            onClick={onVoirDetail}
            aria-label="Voir le détail des sessions et des seuils légaux"
            className="shrink-0 font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Voir le détail
          </button>
        </p>
      </Panneau>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Dernières sessions — jusqu'à 4, avec le taux d'écoulement (docs/06 §1 :
   « la colonne taux d'écoulement et le marqueur de rupture sont les deux
   informations qui pilotent réellement la décision suivante »)
   ═══════════════════════════════════════════════════════════════════════════ */

// 8, pas 4 : mission « bento » du porteur (01/08/2026), remplissage vertical
// à 1920/2560 — aucun chiffre d'affaires ne pin ce nombre à 4 (contrairement
// aux « 3 meilleurs lieux », une demande EXPLICITE du porteur, jamais
// touchée ici) ; un historique un peu plus long sert directement « toutes
// les données sous la main », sans dupliquer l'écran Sessions (qui liste,
// lui, la totalité).
const NOMBRE_DERNIERES_SESSIONS = 8;

/**
 * Le taux de vendu/produit portait trois habillages différents selon
 * l'écran (audit visuel du 30/07/2026, `docs/23-AUDIT-VISUEL.md` §3.1) :
 * « Écoulement » en entier ICI — tronqué par CSS à largeur étroite en
 * `ÉCOULE…`, une troncature qui dépend de la largeur du navigateur et coupe
 * où elle veut — et « ÉCOUL. », abréviation propre, sur `Sessions.tsx`.
 *
 * `LIBELLE_ECOULEMENT` et `titreEcoulement` vivaient dupliqués mot pour mot
 * ici et dans `Sessions.tsx` (aucun module commun n'était dans le
 * périmètre d'écriture de cette mission-là) : consolidés depuis dans
 * `packages/core/src/affichage.ts`, seul module partagé par les deux
 * écrans. Ré-exportés ici pour ne rien changer aux imports existants
 * (`TableauDeBord.test.tsx`).
 *
 * Le mot entier ne vivait QUE dans l'infobulle de chaque VALEUR (`titre`,
 * `composants/Tableau.tsx`) : l'en-tête réaffichait sa propre abréviation
 * au survol (`title={colonne.libelle}`, `Tableau.tsx:172`), faute d'un
 * champ distinct pour le porter. `libelleLong`, ajouté depuis à
 * `ColonneTableau`, comble ce manque ci-dessous.
 */
export { LIBELLE_ECOULEMENT, titreEcoulement };

type EtatDernieresSessions =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; sessions: readonly SessionResume[] };

/**
 * Erreur absolue mesurée entre la demande PRÉVUE (médiane du modèle) et le
 * RÉALISÉ (crêpes vendues) pour une session — `erreurAbsolueBp`, déjà calculé
 * et stocké à la clôture (`rapprocherPrevision`,
 * `packages/db/src/depots/previsions.ts`), jamais recalculé ici (CLAUDE.md
 * §3 règle 1). `null` quand aucune prévision n'a jamais été archivée pour
 * cette session (cas normal : rien n'oblige à archiver une prévision avant
 * chaque session, `ProchaineSession.tsx`, bouton « Archiver cette
 * prévision »).
 *
 * `previsions` est déjà trié de la plus récente à la plus ancienne par le
 * serveur (`GET /previsions`, `listerPrevisions`) : le premier match est donc
 * la prévision la plus récemment calculée pour cette session — même lecture
 * que `previsionRetenue` dans `Production.tsx`
 * (`etatPrevisions.previsions.find((p) => p.sessionId === sessionIdSaisie)`).
 *
 * Exportée pour être testée sans monter le tableau (même convention que
 * `echeancesDansHorizon` ci-dessus).
 */
export function ecartPrevuRealisePourSession(
  previsions: readonly PrevisionArchivee[],
  sessionId: string,
): number | null {
  return previsions.find((p) => p.sessionId === sessionId)?.erreurAbsolueBp ?? null;
}

/**
 * Colonnes de « Dernières sessions », PARAMÉTRÉES par les prévisions
 * archivées : la colonne « Écart » a besoin de `previsions` pour chaque
 * rangée (`ecartPrevuRealisePourSession`), donc ce n'est plus une constante
 * mais une fonction — même patron que `COLONNES(coutsDisponibles)` dans
 * `ComparaisonLieux.tsx`. Largeurs réparties pour la somme exacte de 100 %
 * (garde D-081, `apps/api/src/tableau-largeurs-colonnes.test.ts`) : la
 * cinquième colonne a repris quelques points à chacune des quatre autres.
 */
function colonnesDernieresSessions(
  previsions: readonly PrevisionArchivee[],
): ReadonlyArray<ColonneTableau<SessionResume>> {
  return [
    {
      cle: 'date',
      libelle: 'Date',
      largeur: '22%',
      alignement: 'texte',
      rendu: (s) => formaterDate(s.dateSession),
    },
    {
      cle: 'ca',
      libelle: 'CA',
      largeur: '19%',
      alignement: 'nombre',
      rendu: (s) => ouTiret(s.caTotalCents, formaterEuros),
    },
    {
      // Mesuré au navigateur à 1280 px (audit multi-résolution du
      // 01/08/2026) : « Marge nette » débordait d'1 px à 20 % — sous 100 %
      // de large de moins que le libellé, un cas que D-081 (somme = 100) ne
      // peut pas voir puisqu'il ne mesure que des pourcentages déclarés,
      // jamais le rendu réel. Repris sur `date`/`ca` (100 → 22+19+22+18+19).
      cle: 'marge',
      libelle: 'Marge nette',
      largeur: '22%',
      alignement: 'nombre',
      rendu: (s) => ouTiret(s.margeNetteCents, formaterEuros),
    },
    {
      cle: 'ecoulement',
      libelle: LIBELLE_ECOULEMENT,
      libelleLong: LIBELLE_ECOULEMENT_LONG,
      largeur: '18%',
      alignement: 'nombre',
      rendu: (s) => ouTiret(s.tauxEcoulementBp, formaterPourcent),
      titre: (s) => titreEcoulement(s.tauxEcoulementBp),
    },
    {
      // « Si la prévision avait raison » (mission « finir le tableau de
      // bord ») : la seule information qui apprend à faire confiance — ou
      // non — au chiffre proposé le samedi soir. Colonne `nombre` comme les
      // autres pourcentages de ce tableau (docs/07 §4.5) ; aucun glyphe ni
      // couleur — ce n'est pas une action à traiter (docs/07, le glyphe ▲
      // est réservé à ce qui en demande une), c'est un repère de confiance.
      cle: 'ecart',
      libelle: 'Écart',
      libelleLong: 'Écart prévu/réalisé',
      largeur: '19%',
      alignement: 'nombre',
      rendu: (s) => ouTiret(ecartPrevuRealisePourSession(previsions, s.id), formaterPourcent),
      titre: (s) => {
        const valeur = ecartPrevuRealisePourSession(previsions, s.id);
        return valeur === null
          ? 'Aucune prévision archivée pour cette session : rien à comparer.'
          : `${formaterPourcent(valeur)} — écart absolu entre la demande prévue (médiane) et les crêpes vendues.`;
      },
    },
  ];
}

function SectionDernieresSessions({
  etat,
  previsions,
  onVoirToutes,
}: {
  etat: EtatDernieresSessions;
  previsions: readonly PrevisionArchivee[];
  onVoirToutes: () => void;
}) {
  // Le wrapper de largeur bento (`2xl:col-span-6`, mission « bento » du
  // porteur) ne vit QUE sur les branches qui rendent réellement quelque
  // chose : sur le `return null` ci-dessous (aucune session close), ce
  // panneau doit continuer à disparaître sans laisser la moindre case vide
  // dans la grille.
  if (etat.statut === 'chargement')
    return (
      <div className="2xl:col-span-6">
        <p className="text-sm text-ink-3">Chargement des sessions…</p>
      </div>
    );

  if (etat.statut === 'erreur') {
    return (
      <div className="2xl:col-span-6">
        <EncartErreur titre="Dernières sessions" message={etat.message} />
      </div>
    );
  }

  // Aucune session close : rien à afficher tant que le premier marché n'a pas
  // été clôturé (section masquée, docs/07 §2.1).
  if (etat.sessions.length === 0) return null;

  return (
    <div className="2xl:col-span-6">
      <Panneau titre="Dernières sessions" sansRembourrage>
        <Tableau
          colonnes={colonnesDernieresSessions(previsions)}
          lignes={etat.sessions}
          cleLigne={(s) => s.id}
          etatVide={<EtatVide variante="normal" texte="Aucune session clôturée." />}
        />
        <p className="flex justify-end border-t border-line px-4 py-2">
          <button
            type="button"
            onClick={onVoirToutes}
            className="text-sm font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Voir toutes les sessions
          </button>
        </p>
      </Panneau>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Palmarès — produits (transformé et revendu, classements SÉPARÉS, choix du
   porteur) et fournisseurs. Mission dédiée, docs/07 §2.2 (la *cue*) et §2.8
   (8 à 12 KPI maximum sur un tableau opérationnel).
   ═══════════════════════════════════════════════════════════════════════════

   LA FORME RETENUE, ET POURQUOI (la vraie décision de cette mission).

   Quatre critères produit × deux natures, et cinq critères fournisseur :
   demandés tels quels (« tu peux faire les 4 » / « les cinq »), ils ne
   tiennent PAS dans un encart au sens classique — quatre colonnes ou quatre
   sous-tableaux auraient coûté quatre fois la hauteur, la ressource la plus
   rare de cet écran (docs/07 §4.4 : ~16 rangées visibles en tout à
   1280 × 720).

   Solution retenue : UN SEUL classement affiché à la fois, un SÉLECTEUR DE
   CRITÈRE (même mécanique que `SelecteurHorizon` ci-dessus) qui REJOUE le
   même classement sans le moindre aller-retour réseau — les quatre/cinq
   valeurs sont déjà dans la réponse de l'API, seul l'ORDRE d'affichage
   change. Trois premiers rangs seulement par groupe : assez pour répondre à
   « qu'est-ce qui marche le mieux », pas assez pour transformer ce panneau
   en second écran « Produits »/« Fournisseurs » (qui existent déjà et
   restent la bonne destination pour explorer le classement complet — lien
   « Voir le détail » en bas de chaque panneau).

   Un critère qui n'a AUCUNE valeur aujourd'hui (marge par minute de cuisson ;
   délai de livraison et qualité produit fournisseur) reste un bouton du
   sélecteur, jamais masqué : le sélectionner affiche la RAISON à la place
   d'un classement, exactement la doctrine « en creux avec sa raison, jamais
   une valeur par défaut » du porteur.

   Et quand deux critères désignent des gagnants différents, ce fichier NE
   LE CACHE PAS : `divergenceVenteRentabilite`, déjà calculée côté serveur
   (`packages/core/src/palmares.ts`), s'affiche en toutes lettres sous le
   groupe concerné — « le produit le plus vendu n'est pas le plus rentable »
   est une information, pas un problème (mission du porteur).

   PÉRIODE : 365 jours glissants (voir `packages/core/src/palmares.ts` pour
   la justification complète), affichée à côté du sélecteur — un classement
   sans sa fenêtre est incomparable (docs/07 §2.8).

   Aucun calcul métier ici (CLAUDE.md §3 règle 1) : `trierClassementProduits`
   et `trierClassementFournisseurs` sont importées de `@batte/core`, déjà
   testées ; ce fichier ne fait qu'appeler l'une d'elles puis découper les
   trois premières lignes — exactement le niveau de `echeancesDansHorizon`
   ci-dessus, jamais une marge ou un écart recalculé ici. */

/** Options du sélecteur de critère produit, dans l'ordre demandé par le porteur. */
const OPTIONS_CRITERE_PRODUIT: ReadonlyArray<{
  critere: CritereProduitContrat;
  libelle: string;
  disponible: boolean;
}> = [
  { critere: 'marge_totale', libelle: 'Marge totale', disponible: true },
  { critere: 'volume_vendu', libelle: 'Volume vendu', disponible: true },
  { critere: 'marge_unitaire', libelle: 'Marge/unité', disponible: true },
  { critere: 'marge_par_minute_cuisson', libelle: 'Marge/min cuisson', disponible: false },
];

const CRITERE_PRODUIT_PAR_DEFAUT: CritereProduitContrat = 'marge_totale';

/** Options du sélecteur de critère fournisseur, dans l'ordre demandé par le porteur. */
const OPTIONS_CRITERE_FOURNISSEUR: ReadonlyArray<{
  critere: CritereFournisseurContrat;
  libelle: string;
  disponible: boolean;
}> = [
  { critere: 'economie_generee', libelle: 'Économie', disponible: true },
  { critere: 'fiabilite_facturation', libelle: 'Fiabilité facture', disponible: true },
  { critere: 'prix_comparable', libelle: 'Prix comparable', disponible: true },
  { critere: 'delai_livraison', libelle: 'Délai livraison', disponible: false },
  { critere: 'qualite_produit', libelle: 'Qualité produit', disponible: false },
];

const CRITERE_FOURNISSEUR_PAR_DEFAUT: CritereFournisseurContrat = 'economie_generee';

/**
 * Valeur affichée pour un produit selon le critère choisi. Formatage pur —
 * `ouTiret` porte déjà la doctrine « inconnu ≠ zéro » (`@batte/core`), aucune
 * décision nouvelle prise ici.
 */
export function formaterValeurCritereProduit(
  ligne: LigneClassementProduitContrat,
  critere: CritereProduitContrat,
): string {
  switch (critere) {
    case 'marge_totale':
      return ouTiret(ligne.margeTotaleGenereeCents, formaterEuros);
    case 'marge_unitaire':
      return ouTiret(ligne.margeUnitaireMoyenneCents, formaterEuros);
    case 'volume_vendu':
      return `${ligne.volumeVendu}`;
    case 'marge_par_minute_cuisson':
      return TIRET_ABSENT;
  }
}

/** Valeur affichée pour un fournisseur selon le critère choisi — même principe que ci-dessus. */
export function formaterValeurCritereFournisseur(
  ligne: LigneClassementFournisseurContrat,
  critere: CritereFournisseurContrat,
): string {
  switch (critere) {
    case 'economie_generee':
      return formaterEuros(ligne.economieGenereeCents);
    case 'fiabilite_facturation':
      return ouTiret(ligne.fiabiliteFacturationBp, formaterPourcent);
    case 'prix_comparable':
      return ouTiret(ligne.prixComparableEcartBp, formaterPourcent);
    case 'delai_livraison':
    case 'qualite_produit':
      return TIRET_ABSENT;
  }
}

/** Libellé du groupe produit — jamais « transformé »/« revendu » brut à l'écran (glossaire, docs/07 §0). */
function libelleNatureProduit(nature: 'transforme' | 'revendu'): string {
  return nature === 'transforme' ? 'Crêpes (transformé)' : 'Produits revendus';
}

function SelecteurCritereProduit({
  critere,
  onChanger,
}: {
  critere: CritereProduitContrat;
  onChanger: (c: CritereProduitContrat) => void;
}) {
  return (
    <div
      className="flex flex-wrap gap-groupe"
      role="group"
      aria-label="Critère de classement des produits"
    >
      {OPTIONS_CRITERE_PRODUIT.map((option) => (
        <button
          key={option.critere}
          type="button"
          onClick={() => onChanger(option.critere)}
          aria-pressed={option.critere === critere}
          className={
            'h-controle shrink-0 rounded-sm border px-2 text-xs ' +
            (option.critere === critere
              ? 'border-accent bg-accent text-on-accent'
              : `border-line-field hover:bg-surface-sunken ${option.disponible ? 'text-ink-2' : 'text-ink-3'}`)
          }
        >
          {option.libelle}
        </button>
      ))}
    </div>
  );
}

function SelecteurCritereFournisseur({
  critere,
  onChanger,
}: {
  critere: CritereFournisseurContrat;
  onChanger: (c: CritereFournisseurContrat) => void;
}) {
  return (
    <div
      className="flex flex-wrap gap-groupe"
      role="group"
      aria-label="Critère de classement des fournisseurs"
    >
      {OPTIONS_CRITERE_FOURNISSEUR.map((option) => (
        <button
          key={option.critere}
          type="button"
          onClick={() => onChanger(option.critere)}
          aria-pressed={option.critere === critere}
          className={
            'h-controle shrink-0 rounded-sm border px-2 text-xs ' +
            (option.critere === critere
              ? 'border-accent bg-accent text-on-accent'
              : `border-line-field hover:bg-surface-sunken ${option.disponible ? 'text-ink-2' : 'text-ink-3'}`)
          }
        >
          {option.libelle}
        </button>
      ))}
    </div>
  );
}

function LignePalmaresProduit({
  ligne,
  critere,
}: {
  ligne: LigneClassementProduitContrat;
  critere: CritereProduitContrat;
}) {
  return (
    <div className="flex h-rangee items-center justify-between gap-groupe border-b border-line px-4 text-sm last:border-b-0">
      <span className="truncate text-ink-2">{ligne.nom}</span>
      <span className="shrink-0 tabular-nums font-medium text-ink">
        {formaterValeurCritereProduit(ligne, critere)}
      </span>
    </div>
  );
}

function LignePalmaresFournisseur({
  ligne,
  critere,
}: {
  ligne: LigneClassementFournisseurContrat;
  critere: CritereFournisseurContrat;
}) {
  return (
    <div className="flex h-rangee items-center justify-between gap-groupe border-b border-line px-4 text-sm last:border-b-0">
      <span className="truncate text-ink-2">{ligne.nom}</span>
      <span className="shrink-0 tabular-nums font-medium text-ink">
        {formaterValeurCritereFournisseur(ligne, critere)}
      </span>
    </div>
  );
}

/**
 * Un groupe (transformé OU revendu) : sous-en-tête, puis trois premières
 * lignes du classement au critère choisi, puis la divergence vente/marge si
 * le serveur en a détecté une. `trierClassementProduits` est LA SEULE
 * fonction de tri utilisée ici (`@batte/core`, déjà testée) — ce composant
 * ne fait que l'appeler et découper les trois premières lignes.
 */
export function BlocGroupePalmaresProduits({
  groupe,
  critere,
}: {
  groupe: GroupePalmaresProduitsContrat;
  critere: CritereProduitContrat;
}) {
  const sousEntete = <SousEnteteSignaux texte={libelleNatureProduit(groupe.nature)} />;

  if (!groupe.echantillonSuffisant) {
    return (
      <>
        {sousEntete}
        <EtatVide variante="normal" texte={groupe.raisonEchantillonInsuffisant ?? ''} />
      </>
    );
  }

  if (critere === 'marge_par_minute_cuisson') {
    const raison =
      groupe.nature === 'transforme'
        ? RAISON_MARGE_MINUTE_TRANSFORME_INDISPONIBLE
        : RAISON_MARGE_MINUTE_REVENDU_INDISPONIBLE;
    return (
      <>
        {sousEntete}
        <EtatVide variante="normal" texte={raison} />
      </>
    );
  }

  const meilleures = trierClassementProduits(groupe.lignes, critere).slice(0, 3);

  if (meilleures.length === 0) {
    return (
      <>
        {sousEntete}
        <EtatVide variante="normal" texte="Aucun produit vendu sur la période." />
      </>
    );
  }

  return (
    <>
      {sousEntete}
      {meilleures.map((l) => (
        <LignePalmaresProduit key={l.produitVenteId} ligne={l} critere={critere} />
      ))}
      {groupe.divergenceVenteRentabilite !== null && (
        <p className="border-b border-line px-4 py-2 text-xs text-ink-3 last:border-b-0">
          Le produit le plus vendu ({groupe.divergenceVenteRentabilite.nomPlusVendu}) n’est pas le
          plus rentable ({groupe.divergenceVenteRentabilite.nomPlusRentable}).
        </p>
      )}
    </>
  );
}

type EtatPalmaresProduits =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; palmares: PalmaresProduitsContrat };

function SectionPalmaresProduits({
  etat,
  critere,
  onChangerCritere,
  onVoirDetail,
}: {
  etat: EtatPalmaresProduits;
  critere: CritereProduitContrat;
  onChangerCritere: (c: CritereProduitContrat) => void;
  onVoirDetail: () => void;
}) {
  return (
    <Panneau titre="Palmarès produits" sansRembourrage>
      <div className="border-b border-line px-4 py-groupe">
        <SelecteurCritereProduit critere={critere} onChanger={onChangerCritere} />
        {etat.statut === 'pret' && (
          <p className="mt-1 text-2xs text-ink-3">
            Sur les {etat.palmares.periode.jours} derniers jours (
            {formaterDate(etat.palmares.periode.debut)} – {formaterDate(etat.palmares.periode.fin)}
            ).
          </p>
        )}
      </div>

      {etat.statut === 'chargement' && (
        <p className="px-4 py-2 text-sm text-ink-3">Calcul du palmarès…</p>
      )}

      {etat.statut === 'erreur' && <MessageErreur message={etat.message} />}

      {etat.statut === 'pret' &&
        etat.palmares.groupes.map((groupe) => (
          <BlocGroupePalmaresProduits key={groupe.nature} groupe={groupe} critere={critere} />
        ))}

      <p className="flex justify-end border-t border-line px-4 py-2">
        <button
          type="button"
          onClick={onVoirDetail}
          className="text-sm font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Voir le détail
        </button>
      </p>
    </Panneau>
  );
}

type EtatPalmaresFournisseurs =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; palmares: PalmaresFournisseursContrat };

function SectionPalmaresFournisseurs({
  etat,
  critere,
  onChangerCritere,
  onVoirDetail,
}: {
  etat: EtatPalmaresFournisseurs;
  critere: CritereFournisseurContrat;
  onChangerCritere: (c: CritereFournisseurContrat) => void;
  onVoirDetail: () => void;
}) {
  return (
    <Panneau titre="Palmarès fournisseurs" sansRembourrage>
      <div className="border-b border-line px-4 py-groupe">
        <SelecteurCritereFournisseur critere={critere} onChanger={onChangerCritere} />
        {etat.statut === 'pret' && (
          <p className="mt-1 text-2xs text-ink-3">
            Sur les {etat.palmares.periode.jours} derniers jours (
            {formaterDate(etat.palmares.periode.debut)} – {formaterDate(etat.palmares.periode.fin)}
            ).
          </p>
        )}
      </div>

      {etat.statut === 'chargement' && (
        <p className="px-4 py-2 text-sm text-ink-3">Calcul du palmarès…</p>
      )}

      {etat.statut === 'erreur' && <MessageErreur message={etat.message} />}

      {etat.statut === 'pret' && !etat.palmares.echantillonSuffisant && (
        <EtatVide variante="normal" texte={etat.palmares.raisonEchantillonInsuffisant ?? ''} />
      )}

      {etat.statut === 'pret' &&
        etat.palmares.echantillonSuffisant &&
        critere === 'delai_livraison' && (
          <EtatVide variante="normal" texte={etat.palmares.raisonDelaiLivraisonIndisponible} />
        )}

      {etat.statut === 'pret' &&
        etat.palmares.echantillonSuffisant &&
        critere === 'qualite_produit' && (
          <EtatVide variante="normal" texte={etat.palmares.raisonQualiteProduitIndisponible} />
        )}

      {etat.statut === 'pret' &&
        etat.palmares.echantillonSuffisant &&
        critere !== 'delai_livraison' &&
        critere !== 'qualite_produit' &&
        (() => {
          const meilleurs = trierClassementFournisseurs(etat.palmares.lignes, critere).slice(0, 3);
          return meilleurs.length === 0 ? (
            <EtatVide variante="normal" texte="Aucun fournisseur actif sur la période." />
          ) : (
            meilleurs.map((f) => (
              <LignePalmaresFournisseur key={f.fournisseurId} ligne={f} critere={critere} />
            ))
          );
        })()}

      <p className="flex justify-end border-t border-line px-4 py-2">
        <button
          type="button"
          onClick={onVoirDetail}
          className="text-sm font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Voir le détail
        </button>
      </p>
    </Panneau>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Meilleurs lieux de marché — la TÊTE de « Comparaison des lieux », jamais
   un lieu jamais visité (D-082)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Trois meilleurs lieux par marge nette ATTENDUE, jamais un lieu SANS
 * historique (D-082, `docs/05-DECISIONS.md`).
 *
 * `nbSessionsRetenues === 0` exclut un lieu jamais visité MÊME quand
 * `margeNetteAttendueCents` n'est pas `null` : `calculerBaseline`
 * (`packages/core/src/prevision/baseline.ts`) retombe alors entièrement sur
 * le paramètre `prevision_prior_baseline_crepes` (un prior INVENTÉ, jamais
 * confirmé par une vente) — la marge qui en découle n'est donc pas nulle,
 * mais elle n'est pas mesurée non plus. L'écran « Comparaison des lieux »
 * (`ComparaisonLieux.tsx`) garde ces lieux visibles avec un tiret parce que
 * c'est un outil d'ARBITRAGE complet (D-082 l'a tranché ainsi) ; un
 * « meilleurs lieux » qui prétend montrer ce qui MARCHE ferait passer ce
 * prior pour une mesure s'il n'excluait pas aussi ces lignes.
 *
 * `margeNetteAttendueCents === null` exclut séparément les lieux VISITÉS
 * dont la marge reste incalculable (coût ou distance manquants) : un tiret
 * n'a pas sa place dans un top 3.
 *
 * Aucun tri ici : `GET /lieux-rentabilite` rend déjà les lignes triées par
 * marge nette attendue décroissante (nuls en fin de liste) — filtrer
 * conserve cet ordre relatif entre les lignes restantes.
 *
 * Exportée pour être testée directement (même convention que
 * `echeancesDansHorizon` ci-dessus).
 */
export function meilleursLieux(lignes: readonly LigneComparaisonLieu[]): LigneComparaisonLieu[] {
  return lignes
    .filter((l) => l.nbSessionsRetenues > 0 && l.margeNetteAttendueCents !== null)
    .slice(0, 3);
}

type EtatMeilleursLieux =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; lignes: readonly LigneComparaisonLieu[] };

function LigneMeilleurLieu({ ligne }: { ligne: LigneComparaisonLieu }) {
  return (
    <div className="flex h-rangee items-center justify-between gap-groupe border-b border-line px-4 text-sm last:border-b-0">
      <span className="truncate text-ink-2">{ligne.lieuNom}</span>
      <span className="shrink-0 tabular-nums font-medium text-ink">
        {ouTiret(ligne.margeNetteAttendueCents, formaterEuros)}
      </span>
    </div>
  );
}

function SectionMeilleursLieux({
  etat,
  onVoirDetail,
}: {
  etat: EtatMeilleursLieux;
  onVoirDetail: () => void;
}) {
  return (
    <Panneau titre="Meilleurs lieux de marché" sansRembourrage>
      {etat.statut === 'chargement' && (
        <p className="px-4 py-2 text-sm text-ink-3">Calcul des lieux…</p>
      )}

      {etat.statut === 'erreur' && <MessageErreur message={etat.message} />}

      {etat.statut === 'pret' &&
        (() => {
          const meilleurs = meilleursLieux(etat.lignes);
          // Cas vide : soit aucun lieu actif, soit aucun n'a encore
          // d'historique de sessions ET de coûts connus — jamais un tableau
          // avec des tirets, qui laisserait croire à un classement partiel.
          if (meilleurs.length === 0) {
            return (
              <EtatVide
                variante="normal"
                texte="Aucun lieu avec un historique de sessions et une marge connue pour l’instant."
              />
            );
          }
          return meilleurs.map((l) => <LigneMeilleurLieu key={l.lieuId} ligne={l} />);
        })()}

      <p className="flex justify-end border-t border-line px-4 py-2">
        <button
          type="button"
          onClick={onVoirDetail}
          className="text-sm font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Voir le détail
        </button>
      </p>
    </Panneau>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Concurrents — mouvements de prix (mission « la case concurrents »,
   01/08/2026) : « qu'est-ce qui a bougé depuis mon dernier relevé ? »,
   jamais un état qu'on pourrait aller consulter (docs/07 §2.1). Voir
   `GET /concurrents/mouvements` et l'en-tête « Mouvements de prix » de
   `packages/core/src/contrats/concurrents.ts` pour le contrat complet.

   TROIS CHOSES À NE JAMAIS CONFONDRE (le cœur de cette section) :
    - `stable` : le prix N'A PAS bougé. `ecartCents` vaut 0 et ce zéro est
      VRAI — une information vérifiée, pas une absence de mesure ;
    - `nouveau` : un SEUL relevé existe pour ce produit chez ce concurrent
      (ou il vient d'apparaître). `ecartCents` et `prixPrecedentCents` valent
      `null` — ce n'est ni une hausse ni « 0 € d'écart », c'est INCONNU. Un
      `null` affiché comme `0 €` se lirait « prix inchangé », exactement le
      mensonge que ce projet traque partout (CLAUDE.md §7) : jamais rendu ici
      via `formaterEcartMontant` sur une valeur `null`, toujours `ouTiret`
      d'abord ;
    - `hausse` / `baisse` : un mouvement réel, chiffré.

   DÉCOMPTE DE CONCURRENTS DISTINCTS, pas de lignes produit (demande du
   porteur, mot pour mot : « 2 concurrents ont augmenté leurs prix ») — un
   concurrent qui augmente trois produits reste UN concurrent
   (`resumeMouvementsConcurrents` ci-dessous).

   ANCIENNETÉ : les deux dates de chaque mouvement (`dateObservation` /
   `dateObservationPrecedente`) sont rendues exprès par le contrat — un
   mouvement mesuré entre deux relevés espacés de six mois ne vaut pas celui
   d'une semaine, et un audit (`docs/demandes/08-FICHES-CONCURRENTS.md`) a
   déjà relevé qu'on ne voit nulle part qu'une fiche concurrent est devenue
   périmée. `joursEntre` (`@batte/core`, déjà exporté) calcule cet écart,
   jamais réécrit ici. Sur un `nouveau`, `dateObservationPrecedente` vaut
   `null` : aucune ancienneté ne s'affiche, et ce n'est pas « 0 jour »
   (`titreMouvementConcurrent` distingue les deux cas).

   AUCUNE couleur `depassement`/`alerte` (registre de statut métier,
   `Statut`/`GLYPHE_STATUT`, trois entrées exactement) sur une hausse de prix
   concurrent : ce n'est ni une erreur ni une panne, et un concurrent n'est de
   toute façon jamais un fait de conformité de CETTE entreprise. Même
   précédent que `Sessions.tsx` (`affichageStatutSession`, statut
   `planifiee` : « ni conforme, ni alerte, ni dépassement » rendu en texte
   neutre `text-ink-3`, JAMAIS un quatrième membre inventé de `Statut`) : le
   sens de la hausse/baisse est déjà porté par le SIGNE explicite de
   `formaterEcartMontant` (docs/07 §4.5, `+`/`−` systématique), sans emprunter
   au vocabulaire de statut ni en inventer un nouveau.

   DÉTAIL DERRIÈRE LE RÉSUMÉ : seules les lignes `hausse`/`baisse` sont
   listées individuellement — ce sont les seules qui demandent d'être VUES
   (docs/07 §2.1, la doctrine du tableau de bord entier : « il montre ce qui
   demande une décision, jamais un état qu'on peut aller consulter »). Un
   produit `stable` ou un premier `nouveau` relevé ne demande aucune décision
   : ils restent des COMPTES agrégés (`compterMouvementsParStatut`,
   `phraseDetailStableEtNouveau`), jamais une ligne par produit — les
   énumérer une par une referait, sur ce panneau précis, la faute que cette
   même doctrine interdit déjà ailleurs sur cet écran.

   AUCUN relevé du tout (`mouvements.length === 0`, veille concurrentielle
   pas encore commencée) est un troisième état, distinct des deux premiers :
   « aucun mouvement parce que rien n'est saisi » et « aucun mouvement parce
   que tout est stable » ne sont PAS la même phrase — les confondre ferait
   passer une base vide pour un marché figé.

   Placé dans le groupe des panneaux compacts d'intelligence de marché
   (Palmarès produits, Palmarès fournisseurs, Meilleurs lieux), même largeur
   bento (`2xl:col-span-4`, voir le retour de `TableauDeBord` plus bas) —
   aucun panneau existant déplacé ni retiré.
   ═══════════════════════════════════════════════════════════════════════════ */

type EtatMouvementsConcurrents =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; mouvements: readonly MouvementPrixConcurrent[] };

/**
 * Décompte de concurrents DISTINCTS ayant au moins un produit en hausse (ou
 * en baisse) depuis leur avant-dernier relevé — jamais un décompte de lignes
 * produit (un même concurrent qui augmente trois produits reste UN
 * concurrent). Fonction PURE, exportée pour être testée directement, sans
 * passer par le rendu de l'écran.
 */
export function resumeMouvementsConcurrents(mouvements: readonly MouvementPrixConcurrent[]): {
  nbConcurrentsHausse: number;
  nbConcurrentsBaisse: number;
} {
  const enHausse = new Set<string>();
  const enBaisse = new Set<string>();
  for (const m of mouvements) {
    if (m.statut === 'hausse') enHausse.add(m.concurrentId);
    if (m.statut === 'baisse') enBaisse.add(m.concurrentId);
  }
  return { nbConcurrentsHausse: enHausse.size, nbConcurrentsBaisse: enBaisse.size };
}

/**
 * Phrase de résumé, proche mot pour mot de la demande du porteur
 * (« 2 concurrents ont augmenté leurs prix »). `null` quand ni hausse ni
 * baisse : la distinction entre « rien n'a bougé » (au moins un `stable`) et
 * « rien à comparer encore » (uniquement des `nouveau`) revient à l'appelant
 * — voir `phraseEnTeteMouvementsConcurrents` ci-dessous, qui a besoin du
 * compte PAR STATUT pour trancher, pas seulement de ce résumé.
 */
export function phraseResumeMouvementsConcurrents(resume: {
  nbConcurrentsHausse: number;
  nbConcurrentsBaisse: number;
}): string | null {
  const parties: string[] = [];
  if (resume.nbConcurrentsHausse > 0) {
    parties.push(
      resume.nbConcurrentsHausse > 1
        ? `${resume.nbConcurrentsHausse} concurrents ont augmenté leurs prix`
        : '1 concurrent a augmenté ses prix',
    );
  }
  if (resume.nbConcurrentsBaisse > 0) {
    parties.push(
      resume.nbConcurrentsBaisse > 1
        ? `${resume.nbConcurrentsBaisse} concurrents ont baissé leurs prix`
        : '1 concurrent a baissé ses prix',
    );
  }
  return parties.length === 0 ? null : `${parties.join(', ')} depuis leur dernier relevé.`;
}

/**
 * Compte des LIGNES PRODUIT par statut (contrairement à
 * `resumeMouvementsConcurrents` ci-dessus, qui compte des concurrents
 * distincts) — sert uniquement à choisir la phrase d'en-tête et le résumé
 * stable/nouveau ci-dessous, jamais à afficher un classement.
 */
export function compterMouvementsParStatut(
  mouvements: readonly MouvementPrixConcurrent[],
): Record<StatutMouvementPrix, number> {
  const compte: Record<StatutMouvementPrix, number> = {
    hausse: 0,
    baisse: 0,
    stable: 0,
    nouveau: 0,
  };
  for (const m of mouvements) compte[m.statut] += 1;
  return compte;
}

/**
 * Phrase d'en-tête du panneau — suppose `mouvements.length > 0` (l'appelant,
 * `SectionMouvementsConcurrents`, traite l'absence totale de relevé
 * séparément avec un `EtatVide` distinct).
 *
 * Distingue deux « rien n'a bougé » qui ne sont PAS la même phrase :
 *  - au moins un produit `stable` existe → « Aucun prix n'a bougé… », une
 *    information VÉRIFIÉE ;
 *  - tout le reste est `nouveau` (aucun `stable`, ni `hausse`/`baisse`) →
 *    « Rien à comparer… », rien n'a encore de second relevé à comparer.
 *
 * Exportée pour être testée directement.
 */
export function phraseEnTeteMouvementsConcurrents(
  mouvements: readonly MouvementPrixConcurrent[],
): string {
  const phraseMouvement = phraseResumeMouvementsConcurrents(
    resumeMouvementsConcurrents(mouvements),
  );
  if (phraseMouvement !== null) return phraseMouvement;
  const compte = compterMouvementsParStatut(mouvements);
  return compte.stable > 0
    ? 'Aucun prix n’a bougé depuis le dernier relevé.'
    : 'Rien à comparer pour l’instant : uniquement des premiers relevés.';
}

/**
 * Phrase de repli sur les catégories NON listées individuellement
 * (`stable`/`nouveau`, voir la documentation de tête de cette section) —
 * `null` quand les deux comptes sont nuls (rien à ajouter au-delà de
 * l'en-tête, tous les produits suivis sont en `hausse`/`baisse`).
 */
export function phraseDetailStableEtNouveau(
  compte: Record<StatutMouvementPrix, number>,
): string | null {
  const parties: string[] = [];
  if (compte.stable > 0) {
    parties.push(`${compte.stable} produit${compte.stable > 1 ? 's' : ''} sans changement`);
  }
  if (compte.nouveau > 0) {
    parties.push(
      `${compte.nouveau} premier${compte.nouveau > 1 ? 's' : ''} relevé${
        compte.nouveau > 1 ? 's' : ''
      } (rien à comparer encore)`,
    );
  }
  return parties.length === 0 ? null : parties.join(' — ');
}

/**
 * Infobulle d'une ligne de mouvement — nomme le produit, le prix ACTUEL, et
 * soit l'ancien prix et sa date (mouvement réel), soit explicitement
 * « premier relevé » (jamais une comparaison inventée depuis zéro).
 * `joursEntre` (`@batte/core`) calcule l'écart entre les deux dates, jamais
 * réécrit ici. Exportée pour être testée directement.
 */
export function titreMouvementConcurrent(mouvement: MouvementPrixConcurrent): string {
  if (mouvement.prixPrecedentCents === null || mouvement.dateObservationPrecedente === null) {
    return (
      `${mouvement.concurrentNom} — ${mouvement.nomProduit} : ` +
      `${formaterEuros(mouvement.prixCents)} (premier relevé, le ` +
      `${formaterDate(mouvement.dateObservation)}).`
    );
  }
  const jours = joursEntre(mouvement.dateObservationPrecedente, mouvement.dateObservation);
  return (
    `${mouvement.concurrentNom} — ${mouvement.nomProduit} : ${formaterEuros(mouvement.prixCents)} ` +
    `(était ${formaterEuros(mouvement.prixPrecedentCents)} le ` +
    `${formaterDate(mouvement.dateObservationPrecedente)}, sur ${jours} jour${jours > 1 ? 's' : ''}).`
  );
}

/**
 * Ligne d'un mouvement RÉEL (`hausse`/`baisse` uniquement, voir la
 * documentation de tête) : le nom, le produit, et l'écart SIGNÉ — jamais de
 * couleur ni de glyphe de statut métier (voir la documentation de tête), le
 * signe explicite de `formaterEcartMontant` porte déjà la direction.
 */
function LigneMouvementConcurrent({ mouvement }: { mouvement: MouvementPrixConcurrent }) {
  const jours =
    mouvement.dateObservationPrecedente === null
      ? null
      : joursEntre(mouvement.dateObservationPrecedente, mouvement.dateObservation);
  return (
    <div
      className="flex h-rangee items-center justify-between gap-groupe border-b border-line px-4 text-sm last:border-b-0"
      title={titreMouvementConcurrent(mouvement)}
    >
      <span className="truncate text-ink-2">
        {mouvement.concurrentNom} <span className="text-ink-3">— {mouvement.nomProduit}</span>
      </span>
      <span className="flex shrink-0 items-baseline gap-groupe">
        {jours !== null && <span className="text-2xs text-ink-3">sur {jours} j</span>}
        <span className="tabular-nums font-medium text-ink">
          {ouTiret(mouvement.ecartCents, formaterEcartMontant)}
        </span>
      </span>
    </div>
  );
}

export function SectionMouvementsConcurrents({
  etat,
  onVoirDetail,
}: {
  etat: EtatMouvementsConcurrents;
  onVoirDetail: () => void;
}) {
  return (
    <Panneau titre="Concurrents — mouvements de prix" sansRembourrage>
      {etat.statut === 'chargement' && (
        <p className="px-4 py-2 text-sm text-ink-3">Calcul des mouvements de prix…</p>
      )}

      {etat.statut === 'erreur' && <MessageErreur message={etat.message} />}

      {/* Aucun relevé du tout — distinct de « tout est stable » ci-dessous
          (voir la documentation de tête). */}
      {etat.statut === 'pret' && etat.mouvements.length === 0 && (
        <EtatVide variante="normal" texte="Aucun relevé de concurrent enregistré pour l’instant." />
      )}

      {etat.statut === 'pret' &&
        etat.mouvements.length > 0 &&
        (() => {
          const compte = compterMouvementsParStatut(etat.mouvements);
          const mouvementsReels = etat.mouvements.filter(
            (m) => m.statut === 'hausse' || m.statut === 'baisse',
          );
          const detail = phraseDetailStableEtNouveau(compte);
          return (
            <>
              <p className="border-b border-line px-4 py-2 text-sm text-ink-2">
                {phraseEnTeteMouvementsConcurrents(etat.mouvements)}
              </p>
              {mouvementsReels.map((m) => (
                <LigneMouvementConcurrent key={`${m.concurrentId}-${m.nomProduit}`} mouvement={m} />
              ))}
              {detail !== null && (
                <p className="border-b border-line px-4 py-2 text-xs text-ink-3 last:border-b-0">
                  {detail}
                </p>
              )}
            </>
          );
        })()}

      <p className="flex justify-end border-t border-line px-4 py-2">
        <button
          type="button"
          onClick={onVoirDetail}
          className="text-sm font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Voir le détail
        </button>
      </p>
    </Panneau>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Budget IA — pied de page discret, jamais un encart (CLAUDE.md §5)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Phrase du pied de page « Budget IA » — DÉCISION D'AFFICHAGE seule, aucun
 * calcul (CLAUDE.md §3 règle 1) : plafond, dépense du mois et reste viennent
 * tels quels de `GET /ia/etat`.
 *
 * Distingue « aucun appel journalisé ce mois-ci » de « 0,00 € dépensés »
 * (CLAUDE.md §7 : une valeur inconnue vaut `null`, jamais 0) — même décision
 * que `resumerBudgetIa` (`AssistanceIa.tsx`), DUPLIQUÉE ici à dessein (même
 * raison que `formaterRentabiliteProposition` plus haut) : c'est une règle de
 * PRÉSENTATION locale à deux écrans, pas un calcul métier partagé, et la
 * mutualiser créerait une dépendance entre deux écrans sans logique commune.
 *
 * Exportée pour être testée directement, sans passer par le rendu de l'écran.
 */
export function phrasePiedBudgetIa(etat: EtatIa): string {
  if (!etat.configuree) {
    return 'Budget IA — assistance Claude non configurée sur ce poste (mode dégradé, CLAUDE.md §5).';
  }
  const depense =
    etat.nbAppelsDuMois === 0
      ? 'aucun appel journalisé ce mois-ci'
      : `${formaterEuros(etat.depenseDuMoisCents)} dépensés ce mois-ci (${etat.nbAppelsDuMois} appel${
          etat.nbAppelsDuMois > 1 ? 's' : ''
        })`;
  return (
    `Budget IA — plafond ${formaterEuros(etat.plafondMensuelCents)}, ${depense}, ` +
    `reste ${formaterEuros(etat.resteCents)}.`
  );
}

type EtatBudgetIaPied =
  { statut: 'chargement' } | { statut: 'erreur' } | { statut: 'pret'; etatIa: EtatIa };

/**
 * Ligne de pied de page, sous les deux colonnes — jamais un `<Panneau>`
 * (mission « finir le tableau de bord », le porteur l'a demandé « discret »).
 * Silencieuse pendant le chargement et sur erreur : l'IA est un confort,
 * jamais une dépendance (CLAUDE.md §5) — une panne de `GET /ia/etat` ne
 * mérite pas un encadré rouge sur l'écran le plus consulté du produit.
 */
function PiedBudgetIa({ etat }: { etat: EtatBudgetIaPied }) {
  if (etat.statut !== 'pret') return null;
  return <p className="text-xs text-ink-3">{phrasePiedBudgetIa(etat.etatIa)}</p>;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Écran
   ═══════════════════════════════════════════════════════════════════════════ */

export default function TableauDeBord() {
  const navigate = useNavigate();

  const [etatPrevision, setEtatPrevision] = useState<EtatPrevision>({ statut: 'chargement' });
  const [etatDemarrage, setEtatDemarrage] = useState<EtatDemarrageEcran>({ statut: 'chargement' });
  const [etatAlertes, setEtatAlertes] = useState<EtatAlertes>({ statut: 'chargement' });
  const [etatSeuils, setEtatSeuils] = useState<EtatSeuils>({ statut: 'chargement' });
  const [etatDernieresSessions, setEtatDernieresSessions] = useState<EtatDernieresSessions>({
    statut: 'chargement',
  });
  const [etatPalmaresProduits, setEtatPalmaresProduits] = useState<EtatPalmaresProduits>({
    statut: 'chargement',
  });
  const [etatPalmaresFournisseurs, setEtatPalmaresFournisseurs] =
    useState<EtatPalmaresFournisseurs>({
      statut: 'chargement',
    });
  // Prévisions ARCHIVÉES (mission « finir le tableau de bord ») : alimente la
  // colonne « Écart » de « Dernières sessions » — `ecartPrevuRealisePourSession`
  // lit cette liste, jamais recalculée ici (CLAUDE.md §3 règle 1).
  const [etatPrevisionsArchivees, setEtatPrevisionsArchivees] = useState<
    | { statut: 'chargement' }
    | { statut: 'erreur' }
    | { statut: 'pret'; previsions: readonly PrevisionArchivee[] }
  >({ statut: 'chargement' });
  const [etatMeilleursLieux, setEtatMeilleursLieux] = useState<EtatMeilleursLieux>({
    statut: 'chargement',
  });
  // Mouvements de prix concurrents (mission « la case concurrents »,
  // 01/08/2026) — voir la documentation de `SectionMouvementsConcurrents`.
  const [etatMouvementsConcurrents, setEtatMouvementsConcurrents] =
    useState<EtatMouvementsConcurrents>({ statut: 'chargement' });
  const [etatBudgetIaPied, setEtatBudgetIaPied] = useState<EtatBudgetIaPied>({
    statut: 'chargement',
  });
  // Sélection du critère de classement, jamais persistée entre deux ouvertures
  // (même raisonnement que `horizonJours` ci-dessous) : un seul appel réseau
  // par panneau à l'ouverture de l'écran, le critère ne fait que RÉORDONNER
  // des lignes déjà reçues.
  const [critereProduit, setCritereProduit] = useState<CritereProduitContrat>(
    CRITERE_PRODUIT_PAR_DEFAUT,
  );
  const [critereFournisseur, setCritereFournisseur] = useState<CritereFournisseurContrat>(
    CRITERE_FOURNISSEUR_PAR_DEFAUT,
  );
  // Horizon PARTAGÉ (docs/demandes/10) : un seul état, un seul sélecteur —
  // logé DANS « Achats à anticiper » et non dans l'en-tête (voir la
  // documentation de `SelecteurHorizon`) —, deux consommateurs (ce même
  // panneau, et la ligne « échéances » de la worklist ci-dessous, qui nomme
  // son propre horizon dans son libellé sans dupliquer le contrôle). Jamais
  // persisté entre deux ouvertures — voir le commentaire de tête de fichier
  // et le rapport de mission : aucun mécanisme de préférence d'affichage
  // n'existe ailleurs dans ce dépôt (recherche `localStorage`/`sessionStorage`
  // négative sur tout `apps/web/src`), et tous les filtres d'écran voisins
  // (`afficherInactifs`, `filtreNature`…) repartent déjà de leur valeur par
  // défaut à chaque rechargement — introduire une exception pour celui-ci
  // serait le SEUL état d'écran à survivre, ce qui surprendrait plus qu'il
  // n'aiderait un dimanche soir où l'habitude est justement de tout retrouver
  // à son état par défaut.
  const [horizonJours, setHorizonJours] = useState(HORIZON_PAR_DEFAUT);
  const [etatAchatsAnticipes, setEtatAchatsAnticipes] = useState<EtatAchatsAnticipes>({
    statut: 'chargement',
  });
  const refSelecteurHorizon = useRef<HTMLDivElement>(null);

  /**
   * Réinitialise l'horizon ET ramène le focus sur le bouton correspondant du
   * sélecteur — cas symétrique de D-079 (`docs/05-DECISIONS.md`) : ce bouton
   * « Réinitialiser » vit dans le bloc « vide » de « Achats à anticiper », qui
   * va disparaître dès que `setHorizonJours` déclenche le rechargement de
   * cette section (retour par `'chargement'`, seul rechargement de cet écran
   * qui traverse encore cet état — voir le commentaire de l'effet ci-dessous).
   * Sans repose de focus explicite, il retomberait sur `<body>`. La cible,
   * `refSelecteurHorizon`, pointe le sélecteur qui vit dans le MÊME panneau,
   * en frère des blocs conditionnels : elle ne fait elle-même JAMAIS partie
   * d'un sous-arbre démonté, elle existe déjà au moment de l'appel.
   */
  function reinitialiserHorizon(): void {
    setHorizonJours(HORIZON_PAR_DEFAUT);
    refSelecteurHorizon.current
      ?.querySelector<HTMLElement>(`[data-horizon-jours="${HORIZON_PAR_DEFAUT}"]`)
      ?.focus();
  }

  useEffect(() => {
    requeteApi<unknown>('/prevision')
      .then((reponse) => {
        setEtatPrevision({ statut: 'pret', prevision: schemaPrevision.parse(reponse) });
      })
      .catch((erreur: unknown) => {
        if (erreur instanceof ErreurApi && erreur.code === 'aucune_session_planifiee') {
          setEtatPrevision({ statut: 'aucune_session', message: erreur.message });
          return;
        }
        // D-082 : « premier passage » est un fait normal, pas une erreur —
        // sans cette branche, ce code tombait dans le `catch` générique
        // ci-dessous et affichait un encadré rouge pour un lieu jamais
        // visité, exactement le défaut que ce correctif retire.
        if (erreur instanceof ErreurApi && erreur.code === 'premier_passage_lieu') {
          setEtatPrevision({ statut: 'premier_passage', message: erreur.message });
          return;
        }
        setEtatPrevision({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi ? erreur.message : 'La prévision n’a pas pu être calculée.',
        });
      });
  }, []);

  useEffect(() => {
    requeteApi<unknown>('/demarrage')
      .then((reponse) => {
        setEtatDemarrage({ statut: 'pret', etat: schemaEtatDemarrage.parse(reponse) });
      })
      .catch((erreur: unknown) => {
        setEtatDemarrage({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi
              ? erreur.message
              : 'L’état de démarrage n’a pas pu être vérifié.',
        });
      });
  }, []);

  useEffect(() => {
    Promise.all([
      requeteApi<unknown>('/stock'),
      requeteApi<unknown>('/afsca/nettoyage/taches-en-retard'),
      requeteApi<unknown>('/afsca/non-conformites'),
      requeteApi<unknown>('/echeances'),
      requeteApi<unknown>('/evenements-decouverte/propositions'),
      requeteApi<unknown>('/parametres'),
      requeteApi<unknown>('/factures'),
      requeteApi<unknown>('/objectifs'),
    ])
      .then(
        ([
          brutStock,
          brutTaches,
          brutNonConformites,
          brutEcheances,
          brutPropositions,
          brutParametres,
          brutFactures,
          brutObjectifs,
        ]) => {
          const stock = schemaEtatStock.parse(brutStock).data;
          const tachesRetard = schemaListeTachesEnRetard.parse(brutTaches).data;
          const nonConformites = schemaListeNonConformites.parse(brutNonConformites).data;
          const echeances = schemaListeEcheances.parse(brutEcheances).data;
          const propositionsEvenements =
            schemaListePropositionsEvenements.parse(brutPropositions).data;
          const factures = schemaListeFactures.parse(brutFactures).data;
          const objectifs = schemaListeObjectifs.parse(brutObjectifs).data;
          // Même paramètre, même fenêtre que la colonne DLC de `Stock.tsx` et
          // que le brief avant-marché : voir le commentaire de
          // `lignesDlcProches`. Une clé absente du catalogue est un défaut de
          // configuration, pas un cas normal — elle bascule l'écran en erreur
          // plutôt que d'inventer un horizon.
          const horizonDlcJours = valeurEntiereParametre(
            schemaListeParametres.parse(brutParametres).data,
            'brief_horizon_alerte_dlc_jours',
            aujourdHui(),
          );
          if (horizonDlcJours === null) {
            throw new Error(
              'Le paramètre « brief_horizon_alerte_dlc_jours » est introuvable dans le catalogue.',
            );
          }
          setEtatAlertes({
            statut: 'pret',
            stock,
            tachesRetard,
            nonConformites,
            echeances,
            propositionsEvenements,
            factures,
            objectifs,
            horizonDlcJours,
          });
        },
      )
      .catch((erreur: unknown) => {
        setEtatAlertes({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi
              ? erreur.message
              : 'Les alertes n’ont pas pu être chargées.',
        });
      });
  }, []);

  useEffect(() => {
    requeteApi<unknown>('/seuils')
      .then((reponse) =>
        setEtatSeuils({ statut: 'pret', tableau: schemaTableauSeuils.parse(reponse) }),
      )
      .catch((erreur: unknown) => {
        setEtatSeuils({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi ? erreur.message : 'Les seuils n’ont pas pu être chargés.',
        });
      });
  }, []);

  useEffect(() => {
    requeteApi<unknown>('/sessions')
      .then((reponse) => {
        const { data } = schemaListeSessions.parse(reponse);
        // La liste est triée date décroissante (`listerSessions`) : les
        // premières sessions CLÔTURÉES rencontrées sont les plus récentes à
        // avoir un réalisé.
        const dernieres = data
          .filter((s) => s.statut === 'cloturee')
          .slice(0, NOMBRE_DERNIERES_SESSIONS);
        setEtatDernieresSessions({ statut: 'pret', sessions: dernieres });
      })
      .catch((erreur: unknown) => {
        setEtatDernieresSessions({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi
              ? erreur.message
              : 'Les sessions n’ont pas pu être chargées.',
        });
      });
  }, []);

  useEffect(() => {
    requeteApi<unknown>('/palmares/produits')
      .then((reponse) => {
        setEtatPalmaresProduits({
          statut: 'pret',
          palmares: schemaPalmaresProduits.parse(reponse),
        });
      })
      .catch((erreur: unknown) => {
        setEtatPalmaresProduits({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi
              ? erreur.message
              : 'Le palmarès des produits n’a pas pu être calculé.',
        });
      });
  }, []);

  useEffect(() => {
    requeteApi<unknown>('/palmares/fournisseurs')
      .then((reponse) => {
        setEtatPalmaresFournisseurs({
          statut: 'pret',
          palmares: schemaPalmaresFournisseurs.parse(reponse),
        });
      })
      .catch((erreur: unknown) => {
        setEtatPalmaresFournisseurs({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi
              ? erreur.message
              : 'Le palmarès des fournisseurs n’a pas pu être calculé.',
        });
      });
  }, []);

  // Prévisions archivées (même route que `Production.tsx` / `QualiteModele.tsx`,
  // `GET /previsions` — déjà utilisée ailleurs, jamais un nouvel appel serveur
  // inventé pour cette mission) : alimente la colonne « Écart » de
  // « Dernières sessions ». Une panne ne bloque rien : la colonne retombe sur
  // le tiret d'absence, exactement comme une session sans prévision archivée.
  useEffect(() => {
    requeteApi<unknown>('/previsions')
      .then((reponse) => {
        setEtatPrevisionsArchivees({
          statut: 'pret',
          previsions: schemaListePrevisions.parse(reponse).data,
        });
      })
      .catch(() => {
        setEtatPrevisionsArchivees({ statut: 'erreur' });
      });
  }, []);

  // Comparaison des lieux (même route que `ComparaisonLieux.tsx`,
  // `GET /lieux-rentabilite`) : alimente « Meilleurs lieux de marché »,
  // filtré ici sur les seuls lieux visités et chiffrés (`meilleursLieux`,
  // D-082).
  useEffect(() => {
    requeteApi<unknown>('/lieux-rentabilite')
      .then((reponse) => {
        setEtatMeilleursLieux({
          statut: 'pret',
          lignes: schemaListeComparaisonLieux.parse(reponse).data,
        });
      })
      .catch((erreur: unknown) => {
        setEtatMeilleursLieux({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi
              ? erreur.message
              : 'La comparaison des lieux n’a pas pu être calculée.',
        });
      });
  }, []);

  // Mouvements de prix concurrents (`GET /concurrents/mouvements`, mission
  // « la case concurrents », 01/08/2026) : pas de `lieuId` — ce panneau est
  // une vue GLOBALE du tableau de bord, contrairement au comparateur de
  // `ProchaineSession.tsx` qui, lui, se scope volontairement au lieu de LA
  // prochaine session. Voir la documentation de `SectionMouvementsConcurrents`.
  useEffect(() => {
    requeteApi<unknown>('/concurrents/mouvements')
      .then((reponse) => {
        setEtatMouvementsConcurrents({
          statut: 'pret',
          mouvements: schemaMouvementsPrixConcurrents.parse(reponse).data,
        });
      })
      .catch((erreur: unknown) => {
        setEtatMouvementsConcurrents({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi
              ? erreur.message
              : 'Les mouvements de prix concurrents n’ont pas pu être chargés.',
        });
      });
  }, []);

  // Budget IA (même route que `AssistanceIa.tsx`, `GET /ia/etat` — CLAUDE.md
  // §5 : « un plafond invisible n'est pas un plafond »). Silencieux sur
  // erreur (voir `PiedBudgetIa`) : l'IA est un confort, jamais une dépendance.
  useEffect(() => {
    requeteApi<unknown>('/ia/etat')
      .then((reponse) => {
        setEtatBudgetIaPied({ statut: 'pret', etatIa: schemaEtatIa.parse(reponse) });
      })
      .catch(() => {
        setEtatBudgetIaPied({ statut: 'erreur' });
      });
  }, []);

  // Dépend de `horizonJours` : chaque changement d'horizon relance l'appel,
  // exactement comme `PrevisionCalendaire.tsx` — même endpoint, même contrat.
  // Un VRAI aller-retour réseau est nécessaire ici (contrairement aux
  // échéances ci-dessous) : la fenêtre est un paramètre de la prévision
  // elle-même, recalculée côté serveur.
  useEffect(() => {
    setEtatAchatsAnticipes({ statut: 'chargement' });
    requeteApi<unknown>(`/prevision-calendaire?horizonJours=${horizonJours}`)
      .then((reponse) => {
        const prevision: PrevisionCalendaireDonnees = schemaPrevisionCalendaire.parse(reponse);
        const nombreAlertes = prevision.alertesReapproPredictives.filter(
          (a) => a.declencheur !== 'aucun',
        ).length;
        const demande = demandeProjeteeFiable(prevision.semaines);
        setEtatAchatsAnticipes({ statut: 'pret', nombreAlertes, demande });
      })
      .catch((erreur: unknown) => {
        setEtatAchatsAnticipes({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi
              ? erreur.message
              : 'Les achats à anticiper n’ont pas pu être calculés.',
        });
      });
  }, [horizonJours]);

  // Recalculée à chaque changement d'horizon SANS refaire le moindre appel
  // réseau : `etatAlertes` porte les données brutes, déjà chargées une seule
  // fois ci-dessus (voir le commentaire de `EtatAlertes`). C'est aussi ce qui
  // rend le changement d'horizon insensible à D-079 par construction : l'état
  // React `etatAlertes` ne retraverse JAMAIS `'chargement'` quand seul
  // l'horizon change, donc le `<Panneau titre="À traiter">` ci-dessous n'est
  // ni démonté ni reconstruit — seul son contenu (les lignes) varie.
  const lignesAlertes = useMemo(
    () =>
      etatAlertes.statut === 'pret'
        ? construireAlertes(
            etatAlertes.stock,
            etatAlertes.tachesRetard,
            etatAlertes.nonConformites,
            etatAlertes.echeances,
            etatAlertes.propositionsEvenements,
            etatAlertes.factures,
            etatAlertes.objectifs,
            horizonJours,
            etatAlertes.horizonDlcJours,
          )
        : [],
    [etatAlertes, horizonJours],
  );

  const rienASignaler = etatAlertes.statut === 'pret' && lignesAlertes.length === 0;

  return (
    <div className="flex flex-col gap-bloc">
      <h1 className="flex h-rangee items-center text-lg text-ink">Tableau de bord</h1>

      {/* Grille BENTO (demande du porteur, 01/08/2026) : « toutes les données
          sous la main au même endroit, comme un cockpit d'avion ». Conçue
          pour 1920 de large, tenue aux trois résolutions réelles du porteur
          (1280, 1920×1080, 2560×1440) :
           - sous `lg` (<1024 px) : empilement en une colonne, rien perdu ;
           - `lg` (≥1024 px, couvre 1280×720) : DEUX colonnes — la hauteur y
             reste la ressource rare (~640 px utiles à 720p), un peu de
             défilement y est normal et attendu ;
           - `2xl` (≥1536 px, couvre 1920 et 2560 de large) : DOUZE colonnes,
             chaque case prenant la largeur que son contenu justifie
             (`col-span-4` pour un chiffre ou un court classement,
             `col-span-6` pour un tableau, `col-span-12` pour la bannière
             d'amorçage) — jamais des colonnes égales, jamais de moitié
             d'écran laissée vide.
          `grid-auto-flow` reste la valeur PAR DÉFAUT (`row`, jamais `dense`) :
          l'ordre visuel suit l'ordre du DOM, donc l'ordre de tabulation au
          clavier (CLAUDE.md §3 règle 10) reste celui qu'on voit à l'écran.
          Profondeur 1 partout (docs/07 §4.8) : ces `div` de largeur ne sont
          que des conteneurs de grille, sans bordure ni fond — jamais une
          carte dans une carte. Chaque case qui peut échouer garde son titre
          ET sa place dans la grille (`EncartErreur`, voir la documentation
          de chaque section) : une case qui s'effondrerait réorganiserait
          toute la grille sous les yeux du porteur.

          `items-stretch`, pas `items-start` (audit multi-résolution du
          01/08/2026 : remplissage vertical insuffisant à 1920/2560 comparé à
          `Comptabilite.tsx`) : chaque case d'une même rangée s'aligne
          désormais sur la plus haute de la rangée, au lieu de rester collée
          en haut avec un vide en dessous — utilitaire Tailwind STANDARD,
          aucun jeton `index.css` nouveau. CE QUE ÇA NE RÉSOUT PAS SEUL :
          `Panneau` (`composants/Panneau.tsx`, hors zone d'écriture) n'a pas
          de variante « remplir la hauteur disponible » — son `<section>` ne
          grandit pas au-delà de son contenu ; `items-stretch` rend la CASE
          (le conteneur) aussi haute que sa voisine, sans étirer le panneau
          À L'INTÉRIEUR. Le reste du remplissage vertical vient de VRAIES
          lignes en plus (`NOMBRE_DERNIERES_SESSIONS` relevé à 8 ci-dessous)
          plutôt que d'un étirement qui déplacerait le vide DANS la carte au
          lieu de EN DESSOUS d'elle — voir le rapport de livraison pour ce
          qu'il faudrait dans `Panneau.tsx`/`index.css` pour aller plus loin. */}
      <div className="grid grid-cols-1 items-stretch gap-bloc lg:grid-cols-2 2xl:grid-cols-12">
        {/* Bannière d'amorçage, pleine largeur quand présente (rare une fois
            la base en place) : `SectionDemarrage` porte elle-même son
            wrapper de largeur, uniquement sur ses branches non vides — voir
            sa documentation. */}
        <SectionDemarrage etat={etatDemarrage} onNaviguer={navigate} />

        <div className="2xl:col-span-4">
          <SectionPrevision
            etat={etatPrevision}
            onVoirDetail={() => navigate('/prochaine-session')}
            onCreerSession={() => navigate('/sessions')}
          />
        </div>

        <div className="2xl:col-span-4">
          {etatAlertes.statut === 'chargement' && (
            <p className="text-sm text-ink-3">Vérification des alertes…</p>
          )}

          {etatAlertes.statut === 'erreur' && (
            <EncartErreur titre="À traiter" message={etatAlertes.message} />
          )}

          {/* Rien à traiter : une ligne discrète, jamais une carte titrée
              « aucune alerte » (docs/07 §2.1, consigne explicite de cet
              écran). */}
          {rienASignaler && <EtatVide variante="normal" texte="Rien à signaler pour le moment." />}

          {etatAlertes.statut === 'pret' && lignesAlertes.length > 0 && (
            <Panneau titre="À traiter" sansRembourrage>
              {lignesAlertes.map((ligne) => (
                <LigneAlerteBouton key={ligne.cle} ligne={ligne} onNaviguer={navigate} />
              ))}
            </Panneau>
          )}
        </div>

        <div className="2xl:col-span-4">
          <SectionAchatsAnticipes
            etat={etatAchatsAnticipes}
            horizonJours={horizonJours}
            onChangerHorizon={setHorizonJours}
            refSelecteurHorizon={refSelecteurHorizon}
            onVoirDetail={() => navigate('/prevision-calendaire')}
            onReinitialiserHorizon={reinitialiserHorizon}
          />
        </div>

        {/* `SectionDernieresSessions` et `SectionSeuils` portent elles-mêmes
            leur `2xl:col-span-6`, uniquement sur leurs branches non vides —
            voir leur documentation respective. */}
        <SectionDernieresSessions
          etat={etatDernieresSessions}
          previsions={
            etatPrevisionsArchivees.statut === 'pret' ? etatPrevisionsArchivees.previsions : []
          }
          onVoirToutes={() => navigate('/sessions')}
        />

        <SectionSeuils etat={etatSeuils} onVoirDetail={() => navigate('/sessions')} />

        <div className="2xl:col-span-4">
          <SectionPalmaresProduits
            etat={etatPalmaresProduits}
            critere={critereProduit}
            onChangerCritere={setCritereProduit}
            onVoirDetail={() => navigate('/produits')}
          />
        </div>

        <div className="2xl:col-span-4">
          <SectionPalmaresFournisseurs
            etat={etatPalmaresFournisseurs}
            critere={critereFournisseur}
            onChangerCritere={setCritereFournisseur}
            onVoirDetail={() => navigate('/fournisseurs')}
          />
        </div>

        <div className="2xl:col-span-4">
          <SectionMeilleursLieux
            etat={etatMeilleursLieux}
            onVoirDetail={() => navigate('/comparaison-lieux')}
          />
        </div>

        <div className="2xl:col-span-4">
          <SectionMouvementsConcurrents
            etat={etatMouvementsConcurrents}
            onVoirDetail={() => navigate('/concurrents')}
          />
        </div>
      </div>

      {/* Pied discret, hors de la grille : le porteur l'a demandé
          « discret » (mission « finir le tableau de bord ») — jamais une
          case de plus. */}
      <PiedBudgetIa etat={etatBudgetIaPied} />
    </div>
  );
}
