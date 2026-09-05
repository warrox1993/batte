import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TIRET_ABSENT,
  formaterMontant,
  ouTiret,
  schemaListeComparaisonLieux,
  type FiabiliteLieuContrat,
  type LigneComparaisonLieu,
  type ListeComparaisonLieux,
} from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { MessageErreur } from '../composants/EncartErreur';
import { ErreurApi, requeteApi } from '../lib/api';

/**
 * Écran de comparaison des lieux par marge nette ATTENDUE
 * (docs/demandes/13-COUT-COMPLET-ET-ARBITRAGE-ENTRE-LIEUX.md).
 *
 * Aucun calcul métier ici (CLAUDE.md §3 règle 1) : tout vient tel quel de
 * `/api/lieux-rentabilite`, qui compose la baseline de fréquentation
 * (météo/événement neutralisés) et les coûts DIFFÉRENTIELS entre lieux
 * (matière, emplacement, déplacement, gaz).
 *
 * DEUX CHIFFRES, PAS UN (docs/demandes/13 §2) : cet écran ne montre QUE ce
 * qui varie selon le lieu. Aucune charge fixe (assurance, cotisations,
 * amortissements) n'y figure jamais — les inclure écraserait l'écart entre
 * lieux sous des charges identiques partout. Le chiffre « combien je gagne
 * vraiment », lui, vit dans les écrans de comptabilité.
 *
 * NULL VEUT DIRE INCONNU, JAMAIS ZÉRO : une distance ou un coût non
 * renseigné rend la marge nette attendue INCALCULABLE pour ce lieu — jamais
 * affichée à 0 €, ce qui le classerait à tort en tête. Le serveur trie déjà
 * les lignes à marge connue en tête ; cet écran ne re-trie rien.
 */

/**
 * Attribution obligatoire (licence CC-BY 4.0) : la colonne « Distance » de cet
 * écran rend `lieu_marche.distance_km`, qui peut avoir été calculée
 * automatiquement par OpenRouteService à partir de données OpenStreetMap
 * (`apps/api/src/itineraire/client.ts`). Aucune colonne de provenance
 * n'existe en base pour distinguer un calcul automatique d'une saisie
 * manuelle — une mention unique au niveau de l'écran couvre les deux cas.
 */
const MENTION_ATTRIBUTION_DISTANCE =
  'Distance calculée automatiquement via OpenRouteService, © contributeurs OpenStreetMap (CC BY 4.0), ou saisie manuellement.';

const LIBELLES_FIABILITE: Readonly<Record<FiabiliteLieuContrat, string>> = {
  aucune_donnee: 'Aucune session — estimation de départ seule',
  peu_fiable: 'Peu fiable — historique encore court',
  fiable: 'Fiable',
  tres_fiable: 'Très fiable',
};

const CLASSES_FIABILITE: Readonly<Record<FiabiliteLieuContrat, string>> = {
  aucune_donnee: 'text-ink-3',
  peu_fiable: 'text-alerte',
  fiable: 'text-ink-2',
  tres_fiable: 'text-conforme',
};

/**
 * `distanceKm` peut désormais porter une décimale (D-074 : calculée par
 * OpenRouteService au dixième de km près, `apps/api/src/itineraire/
 * client.ts`, là où elle était toujours un compte rond auparavant). Un
 * `${nombre} km` brut afficherait alors un point anglo-saxon (« 12.4 km »)
 * dans un tableau où toutes les autres colonnes numériques (`formaterMontant`)
 * parlent en virgules françaises — même convention que `formaterKm`
 * (`Sessions.tsx`).
 */
function formaterKmColonne(km: number): string {
  return `${new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 1 }).format(km)} km`;
}

function libelleFiabilite(ligne: LigneComparaisonLieu): string {
  const base = LIBELLES_FIABILITE[ligne.fiabilite];
  const nb = ligne.nbSessionsRetenues;
  return nb === 0 ? base : `${base} (${nb} session${nb > 1 ? 's' : ''})`;
}

/** Raison affichée quand la marge nette attendue est incalculable pour cette ligne. */
function raisonMargeIndisponible(ligne: LigneComparaisonLieu, coutsDisponibles: boolean): string {
  if (ligne.distanceKm === null) {
    return 'Distance non renseignée : renseignez-la dans Lieux de marché pour comparer ce lieu.';
  }
  if (ligne.coutEmplacementCents === null) {
    return ligne.coutEmplacementIndisponibleRaison ?? 'Coût d’emplacement indisponible.';
  }
  if (!coutsDisponibles) {
    return 'Prix et coût matière pas encore mesurables (aucune recette ni vente exploitable).';
  }
  if (ligne.coutGazAttenduCents === null) {
    return 'Coût gaz pas encore mesuré (aucune session close nulle part encore).';
  }
  return 'Marge non calculable pour ce lieu.';
}

/**
 * La somme des `largeur` DOIT faire exactement 100 % (audit visuel du
 * 31/07/2026, fiche « tableaux illisibles » lot 3 ; D-081). `Tableau.tsx` pose
 * ces pourcentages sur un `<colgroup>` avec `table-layout: fixed` : si la
 * somme dépasse 100, le navigateur RENORMALISE chaque colonne à `100/somme` —
 * un rétrécissement UNIFORME et silencieux (invisible à la lecture du code)
 * qui s'ajoute à des largeurs déjà justes. C'est ce qui coupait la marge nette
 * attendue en plein milieu d'une décimale (« 32,... » au lieu de « 32,24 »
 * dans une base de démonstration) : dix largeurs sommant à 112 %, donc
 * chaque colonne rendue à 100/112 ≈ 89 % de sa valeur déclarée. Un nombre
 * tronqué est pire qu'un texte tronqué : impossible de savoir combien de
 * décimales ont disparu. Factures.tsx et JournalAudit.tsx n'ont jamais eu ce
 * bug parce que leurs largeurs somment déjà à 100 (16+22+12+16+17+17 et
 * 16+14+12+22+26+10) — même règle appliquée ici.
 *
 * Correctif du 31/07/2026, second passage : la somme faisait déjà 100 (la
 * VALEUR ne se tronquait donc plus, vérifié en base de démonstration — « 32,24 »
 * et « 321,70 » s'affichent en entier), mais quatre EN-TÊTES débordaient
 * encore, mesuré avec `table-layout: auto` sur la même instance (`Crêpes
 * prévues` 114 px pour 82 alloués, `Emplacement` 105 pour 92, `Déplacement`
 * 103 pour 92, et surtout `Marge nette attendue` 164 px pour seulement 92 —
 * plus de la moitié du libellé disparaissait). Un en-tête se tronque TOUJOURS
 * par ellipse, même sur une colonne `nombre` sans `troncature: 'repli'`
 * (`index.css`) : ce n'est pas la règle « un nombre ne se tronque jamais » qui
 * était en cause ici (la valeur passait), mais un en-tête illisible sur la
 * colonne qui sert précisément à arbitrer entre deux marchés. `Marge nette
 * attendue` est abrégé en `Marge nette` avec `libelleLong` portant le libellé
 * complet en infobulle (`Tableau.tsx`, ajouté cette nuit) plutôt que d'occuper
 * 17 % de la largeur pour un seul en-tête — les trois autres ont simplement
 * été élargis, la place étant reprise sur `Lieu`, `Fiabilité`, `Matière` et
 * `Gaz`, dont les besoins mesurés étaient nettement inférieurs à leur
 * allocation (`Gaz` : 48 px nécessaires pour 82 alloués).
 */
function COLONNES(coutsDisponibles: boolean): ReadonlyArray<ColonneTableau<LigneComparaisonLieu>> {
  return [
    {
      cle: 'lieu',
      libelle: 'Lieu',
      largeur: '12%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (l) => l.lieuNom,
    },
    {
      /**
       * `distanceKm === null` s'affiche en `alerte`, PAS en tiret neutre
       * comme les autres colonnes de ce tableau (voir `ouTiret`/`TIRET_ABSENT`
       * plus bas) — écart voulu, pas une incohérence à corriger (vérifié le
       * 31/07/2026).
       *
       * `lieu_marche.distance_km` (`packages/db/src/schema.ts`, commentaire
       * de colonne) est explicite : « un lieu sans distance ne peut pas être
       * comparé aux autres sur la marge nette — l'écran doit le dire au lieu
       * de le classer premier. » Un tiret neutre se lit comme une absence
       * ordinaire parmi d'autres ; ici l'absence bloque le calcul même de la
       * ligne (voir `raisonMargeIndisponible` ci-dessus, qui renvoie
       * précisément ce cas en premier) — c'est une alerte légitime sur
       * l'action à faire (compléter `distanceKm` dans Lieux de marché), pas
       * un jugement porté sur une valeur qui manquerait par hasard.
       */
      cle: 'distance',
      libelle: 'Distance',
      largeur: '8%',
      alignement: 'nombre',
      // `repli` : « inconnue » se coupait en « inco… » sous 1280 px effectifs
      // (fenêtre plus étroite ou mise à l'échelle Windows différente) — une
      // alerte tronquée reste une alerte perdue.
      troncature: 'repli',
      rendu: (l) =>
        l.distanceKm === null ? (
          <span className="text-alerte">inconnue</span>
        ) : (
          formaterKmColonne(l.distanceKm)
        ),
    },
    {
      cle: 'fiabilite',
      libelle: 'Fiabilité',
      largeur: '11%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (l) => <span className={CLASSES_FIABILITE[l.fiabilite]}>{libelleFiabilite(l)}</span>,
      titre: libelleFiabilite,
    },
    {
      cle: 'crepesPrevues',
      libelle: 'Crêpes prévues',
      largeur: '12%',
      alignement: 'nombre',
      rendu: (l) => String(l.crepesPrevuesBaseline),
      titre: (l) => l.explicationBaseline,
    },
    {
      cle: 'ca',
      libelle: 'CA attendu',
      largeur: '10%',
      alignement: 'nombre',
      rendu: (l) => ouTiret(l.caAttenduCents, formaterMontant),
    },
    {
      cle: 'matiere',
      libelle: 'Matière',
      largeur: '8%',
      alignement: 'nombre',
      rendu: (l) => ouTiret(l.coutMatiereAttenduCents, formaterMontant),
    },
    {
      cle: 'emplacement',
      libelle: 'Emplacement',
      largeur: '11%',
      alignement: 'nombre',
      rendu: (l) => ouTiret(l.coutEmplacementCents, formaterMontant),
      titre: (l) => l.coutEmplacementIndisponibleRaison ?? '',
    },
    {
      cle: 'deplacement',
      libelle: 'Déplacement',
      largeur: '11%',
      alignement: 'nombre',
      rendu: (l) => ouTiret(l.coutDeplacementCents, formaterMontant),
    },
    {
      cle: 'gaz',
      libelle: 'Gaz',
      largeur: '6%',
      alignement: 'nombre',
      rendu: (l) => ouTiret(l.coutGazAttenduCents, formaterMontant),
    },
    {
      cle: 'marge',
      libelle: 'Marge nette',
      libelleLong: 'Marge nette attendue',
      largeur: '11%',
      alignement: 'nombre',
      rendu: (l) =>
        l.margeNetteAttendueCents === null ? (
          <span className="text-ink-3">{TIRET_ABSENT}</span>
        ) : (
          <span className="font-medium tabular-nums text-ink">
            {formaterMontant(l.margeNetteAttendueCents)}
          </span>
        ),
      titre: (l) =>
        l.margeNetteAttendueCents === null
          ? raisonMargeIndisponible(l, coutsDisponibles)
          : 'Marge nette attendue = CA attendu − matière − emplacement − déplacement − gaz.',
    },
  ];
}

type EtatEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; donnees: ListeComparaisonLieux };

export default function ComparaisonLieux() {
  const navigate = useNavigate();
  const [etat, setEtat] = useState<EtatEcran>({ statut: 'chargement' });

  const charger = useCallback(async (): Promise<ListeComparaisonLieux> => {
    const reponse = await requeteApi<unknown>('/lieux-rentabilite');
    return schemaListeComparaisonLieux.parse(reponse);
  }, []);

  useEffect(() => {
    let annule = false;

    charger()
      .then((donnees) => {
        if (annule) return;
        setEtat({ statut: 'pret', donnees });
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        setEtat({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi
              ? erreur.message
              : 'Erreur inattendue, sans plus de détail.',
        });
      });

    return () => {
      annule = true;
    };
  }, [charger]);

  return (
    <div className="flex flex-col gap-bloc">
      <h1 className="flex h-rangee items-center text-lg text-ink">Comparaison des lieux</h1>

      {etat.statut === 'chargement' && (
        <p className="text-sm text-ink-3">Chargement de la comparaison…</p>
      )}

      {etat.statut === 'erreur' && <MessageErreur message={etat.message} />}

      {etat.statut === 'pret' && (
        <Contenu donnees={etat.donnees} onAllerLieux={() => navigate('/lieux')} />
      )}
    </div>
  );
}

function Contenu({
  donnees,
  onAllerLieux,
}: {
  donnees: ListeComparaisonLieux;
  onAllerLieux: () => void;
}) {
  if (donnees.meta.total === 0) {
    return (
      <EtatVide
        variante="premier-lancement"
        titre="Aucun lieu actif à comparer"
        explication="Créez au moins un lieu de marché actif pour voir apparaître sa marge nette attendue ici."
        action={{ libelle: 'Aller à Lieux de marché', onClick: onAllerLieux }}
      />
    );
  }

  return (
    <>
      <Panneau titre="Le coût kilométrique retenu">
        <p className="text-sm text-ink-2">
          {donnees.meta.coutKilometriqueLibelle} Aller-retour compté deux fois la distance aller
          simple. Carburant, pneus et entretien uniquement — jamais de valorisation du temps de
          trajet.
        </p>
        <p className="mt-groupe text-xs text-ink-3">
          {donnees.meta.coutKilometriqueOrigine === 'mesure'
            ? 'Ce chiffre prime sur le forfait officiel tant qu’il repose sur assez de pleins ' +
              'enregistrés (écran Comptabilité). Il repasse automatiquement au forfait si le ' +
              'nombre de pleins redescend sous le seuil.'
            : donnees.meta.coutKilometriqueSource}
        </p>
      </Panneau>

      {!donnees.meta.coutsDisponibles && donnees.meta.avertissementCouts !== null && (
        <div
          role="alert"
          className="border-l-2 border-alerte bg-alerte-bg px-3 py-2 text-sm text-alerte"
        >
          {donnees.meta.avertissementCouts}
        </div>
      )}

      <Panneau
        titre={`Lieux actifs — ${donnees.meta.total} lieu${donnees.meta.total > 1 ? 'x' : ''}`}
        sansRembourrage
      >
        <Tableau
          colonnes={COLONNES(donnees.meta.coutsDisponibles)}
          lignes={donnees.data}
          cleLigne={(l) => l.lieuId}
          etatVide={
            <EtatVide
              variante="premier-lancement"
              titre="Aucun lieu actif à comparer"
              explication="Créez au moins un lieu de marché actif pour voir apparaître sa marge nette attendue ici."
              action={{ libelle: 'Aller à Lieux de marché', onClick: onAllerLieux }}
            />
          }
        />
      </Panneau>

      <p className="text-xs text-ink-3">
        Cet écran ne montre QUE ce qui change selon le lieu (matière, emplacement, déplacement,
        gaz). Aucune charge fixe (assurance, cotisations, amortissements) n’y figure : les inclure
        écraserait l’écart entre lieux sous des charges identiques partout. « Combien je gagne
        vraiment » reste une question distincte, répondue ailleurs, charges fixes comprises.
      </p>

      <p className="text-xs text-ink-3">{MENTION_ATTRIBUTION_DISTANCE}</p>
    </>
  );
}
