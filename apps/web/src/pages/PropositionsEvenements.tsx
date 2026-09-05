import { useCallback, useEffect, useState } from 'react';
import { formaterDate, formaterEuros } from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { MessageErreur } from '../composants/EncartErreur';
import { ErreurApi, requeteApi } from '../lib/api';
import {
  DOMAINE_RAYON_RECHERCHE_KM,
  type LieuPourRechercheEvenements,
  type PropositionEvenement,
  type RayonRechercheKm,
  type ResultatRechercheEvenements,
  // Import relatif temporaire : contrat neuf, hors des barrels `@batte/core` /
  // `@batte/db` tant que l'orchestrateur ne les a pas câblés — voir le
  // rapport de livraison pour les lignes exactes à y ajouter. Même
  // convention que `apps/api/src/routes/concurrents.ts` (fiche 08) avant
  // son câblage.
} from '@batte/core';

/**
 * Écran de validation des propositions d'événements découvertes par l'IA
 * (fiche `docs/demandes/05-EVENEMENTS-DECOUVERTE-IA-RAYON-REGLABLE.md`).
 *
 * Aucun calcul métier ici (CLAUDE.md §3 règle 1) : la rentabilité prévue,
 * l'impact et le tri viennent TELS QUELS de l'API. Ce fichier ne fait que de
 * l'affichage et de la saisie d'ajustement (portée/intensité), jamais un
 * calcul de facteur ou de marge.
 *
 * Déclenchement MANUEL — pas de tâche planifiée : ce projet n'a aucun
 * ordonnanceur (voir `apps/api/src/routes/evenements-decouverte.ts`). Le
 * bouton « Chercher des événements » est le seul déclencheur.
 */

type TypeEvenementPropose = PropositionEvenement['type'];
type PorteeEvenementPropose = PropositionEvenement['portee'];
/** `null` = facteur classique (fiche 14) — c'est le cas de toute proposition fraîche. */
type FamilleOpportunitePropose = PropositionEvenement['famille'];

const LIBELLE_FAMILLE: Readonly<Record<Exclude<FamilleOpportunitePropose, null>, string>> = {
  grand_public: 'Grand public',
  entreprise: 'Entreprise',
  marche_noel: 'Marché de Noël',
};

const LIBELLE_TYPE: Readonly<Record<TypeEvenementPropose, string>> = {
  festival: 'Festival',
  ferie: 'Jour férié',
  sportif: 'Événement sportif',
  meteo_exceptionnelle: 'Météo exceptionnelle',
  greve: 'Grève',
  travaux: 'Travaux',
  concurrence: 'Concurrence',
  autre: 'Autre',
};

const LIBELLE_PORTEE: Readonly<Record<PorteeEvenementPropose, string>> = {
  quartier: 'Quartier',
  liege: 'Liège',
  national: 'National',
};

function formaterPeriode(dateDebut: string, dateFin: string): string {
  return dateDebut === dateFin
    ? formaterDate(dateDebut)
    : `${formaterDate(dateDebut)} – ${formaterDate(dateFin)}`;
}

/** `≈ 12 km à vol d'oiseau` — jamais laisser croire à une distance de trajet (fiche 05). */
function formaterDistance(distanceKm: number | null): string {
  if (distanceKm === null) return '—';
  const arrondie = Math.round(distanceKm * 10) / 10;
  return `≈ ${arrondie.toLocaleString('fr-BE')} km à vol d’oiseau`;
}

function formaterRentabilite(cents: number): string {
  return cents >= 0 ? `+${formaterEuros(cents)}` : `−${formaterEuros(Math.abs(cents))}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ajustement local (portée/intensité) avant validation
   ═══════════════════════════════════════════════════════════════════════════ */

type Ajustement = {
  portee: PorteeEvenementPropose;
  intensiteEstimee: number;
  /**
   * Fiche 14 : taguer cette proposition comme une opportunité AVANT
   * validation. `null` par défaut — reconduit le comportement classique
   * (facteur), exactement ce qui se passait avant cette fiche.
   */
  famille: FamilleOpportunitePropose;
  effectifEstime: string;
};

function ajustementInitial(proposition: PropositionEvenement): Ajustement {
  return {
    portee: proposition.portee,
    intensiteEstimee: proposition.intensiteEstimee,
    famille: proposition.famille,
    effectifEstime: proposition.effectifEstime === null ? '' : String(proposition.effectifEstime),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   États de chargement — mêmes conventions que `Evenements.tsx`
   ═══════════════════════════════════════════════════════════════════════════ */

type EtatListe =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; propositions: PropositionEvenement[]; total: number };

type EtatRecherche =
  | { statut: 'inactif' }
  | { statut: 'recherche' }
  | { statut: 'succes'; nombre: number }
  | { statut: 'indisponible'; raison: string }
  | { statut: 'erreur'; message: string };

/** Effacement du message de succès après quelques secondes (docs/07 §4.7). */
const DELAI_SUCCES_MS = 6000;

export default function PropositionsEvenements() {
  const [lieux, setLieux] = useState<LieuPourRechercheEvenements[]>([]);
  const [lieuId, setLieuId] = useState<string>('');
  const [etatListe, setEtatListe] = useState<EtatListe>({ statut: 'chargement' });
  const [etatRecherche, setEtatRecherche] = useState<EtatRecherche>({ statut: 'inactif' });
  const [ajustements, setAjustements] = useState<Record<string, Ajustement>>({});
  const [enCoursId, setEnCoursId] = useState<string | null>(null);
  const [erreurLieux, setErreurLieux] = useState<string | null>(null);

  const chargerPropositions = useCallback(async () => {
    try {
      const brut = await requeteApi<{ data: PropositionEvenement[]; meta: { total: number } }>(
        '/evenements-decouverte/propositions',
      );
      setEtatListe({ statut: 'pret', propositions: brut.data, total: brut.meta.total });
      setAjustements((precedent) => {
        const suivant: Record<string, Ajustement> = { ...precedent };
        for (const proposition of brut.data) {
          if (!(proposition.id in suivant))
            suivant[proposition.id] = ajustementInitial(proposition);
        }
        return suivant;
      });
    } catch (erreur) {
      setEtatListe({
        statut: 'erreur',
        message:
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
      });
    }
  }, []);

  const chargerLieux = useCallback(async () => {
    try {
      const brut = await requeteApi<{ data: LieuPourRechercheEvenements[] }>(
        '/evenements-decouverte/lieux',
      );
      setLieux(brut.data);
      setLieuId((actuel) => (actuel === '' && brut.data.length > 0 ? brut.data[0]!.id : actuel));
      setErreurLieux(null);
    } catch (erreur) {
      // Un lieu non chargé désactive simplement le sélecteur — la liste des
      // propositions déjà en attente reste, elle, consultable (mode dégradé).
      // Mais CLAUDE.md §4 interdit un échec invisible : sans message, « Aucun
      // lieu actif » (option affichée quand `lieux` est vide) se lisait
      // exactement comme une vraie liste vide, alors qu'ici l'appel réseau a
      // simplement échoué.
      setErreurLieux(
        erreur instanceof ErreurApi
          ? erreur.message
          : 'Impossible de charger les lieux de marché, sans plus de détail.',
      );
    }
  }, []);

  useEffect(() => {
    void chargerLieux();
    void chargerPropositions();
  }, [chargerLieux, chargerPropositions]);

  const lieuActuel = lieux.find((l) => l.id === lieuId) ?? null;

  async function changerRayon(rayon: RayonRechercheKm): Promise<void> {
    if (lieuActuel === null) return;
    try {
      const modifie = await requeteApi<LieuPourRechercheEvenements>(
        `/evenements-decouverte/lieux/${lieuActuel.id}/rayon-recherche`,
        { method: 'PATCH', body: JSON.stringify({ rayonRechercheEvenementsKm: rayon }) },
      );
      setLieux((precedent) => precedent.map((l) => (l.id === modifie.id ? modifie : l)));
    } catch (erreur) {
      setEtatRecherche({
        statut: 'erreur',
        message: erreur instanceof ErreurApi ? erreur.message : 'Le changement de rayon a échoué.',
      });
    }
  }

  async function chercherEvenements(): Promise<void> {
    if (lieuActuel === null) return;
    setEtatRecherche({ statut: 'recherche' });
    try {
      const resultat = await requeteApi<ResultatRechercheEvenements>(
        '/evenements-decouverte/rechercher',
        { method: 'POST', body: JSON.stringify({ lieuId: lieuActuel.id }) },
      );
      if (!resultat.disponible) {
        setEtatRecherche({ statut: 'indisponible', raison: resultat.raison });
        return;
      }
      setEtatRecherche({ statut: 'succes', nombre: resultat.propositions.length });
      await chargerPropositions();
    } catch (erreur) {
      setEtatRecherche({
        statut: 'erreur',
        message: erreur instanceof ErreurApi ? erreur.message : 'La recherche a échoué.',
      });
    }
  }

  useEffect(() => {
    if (etatRecherche.statut !== 'succes') return undefined;
    const minuteur = window.setTimeout(
      () => setEtatRecherche({ statut: 'inactif' }),
      DELAI_SUCCES_MS,
    );
    return () => window.clearTimeout(minuteur);
  }, [etatRecherche]);

  function modifierAjustement(id: string, partiel: Partial<Ajustement>): void {
    setAjustements((precedent) => {
      const actuel = precedent[id];
      if (actuel === undefined) return precedent;
      return { ...precedent, [id]: { ...actuel, ...partiel } };
    });
  }

  async function valider(proposition: PropositionEvenement): Promise<void> {
    const ajustement = ajustements[proposition.id] ?? ajustementInitial(proposition);
    setEnCoursId(proposition.id);
    try {
      const effectifSaisi = ajustement.effectifEstime.trim();
      await requeteApi(`/evenements-decouverte/propositions/${proposition.id}/valider`, {
        method: 'POST',
        body: JSON.stringify({
          portee: ajustement.portee,
          intensiteEstimee: ajustement.intensiteEstimee,
          famille: ajustement.famille,
          effectifEstime: effectifSaisi === '' ? null : Number.parseInt(effectifSaisi, 10),
        }),
      });
      await chargerPropositions();
    } catch (erreur) {
      setEtatListe({
        statut: 'erreur',
        message: erreur instanceof ErreurApi ? erreur.message : 'La validation a échoué.',
      });
    } finally {
      setEnCoursId(null);
    }
  }

  async function rejeter(proposition: PropositionEvenement): Promise<void> {
    setEnCoursId(proposition.id);
    try {
      await requeteApi(`/evenements-decouverte/propositions/${proposition.id}/rejeter`, {
        method: 'POST',
      });
      await chargerPropositions();
    } catch (erreur) {
      setEtatListe({
        statut: 'erreur',
        message: erreur instanceof ErreurApi ? erreur.message : 'Le rejet a échoué.',
      });
    } finally {
      setEnCoursId(null);
    }
  }

  /**
   * Entrée valide directement la ligne (docs/07 §4.6) : sans ce gestionnaire,
   * ajuster portée/intensité/famille/effectif au clavier exigeait malgré tout
   * la souris pour atteindre le bouton « Valider ». Un `<form>` par ligne est
   * impossible ici (une `<tr>` ne peut contenir qu'un `<td>`), d'où un
   * `onKeyDown` direct sur chaque contrôle de la ligne plutôt qu'une
   * soumission de formulaire.
   */
  function surEntreeValider(p: PropositionEvenement) {
    return (evenement: { key: string; preventDefault: () => void }) => {
      if (evenement.key !== 'Enter') return;
      evenement.preventDefault();
      void valider(p);
    };
  }

  /**
   * Largeurs CORRIGÉES le 31/07/2026 (mission « tableaux lisibles »).
   *
   * Défaut trouvé : les douze `largeur` sommaient à 129 %, pas 100 (16+9+13+
   * 10+12+9+8+12+7+11+9+13). `table-layout: fixed` renormalise alors CHAQUE
   * colonne à 100/129 ≈ 77,5 % de sa largeur déclarée — un rétrécissement
   * uniforme et invisible en lisant le code, qui s'ajoutait à des largeurs
   * déjà trop justes pour douze colonnes. C'est la cause directe des en-têtes
   * réduits à une lettre (`PO...`, `IN...`, `E...`, `SO...`) relevés par
   * l'audit visuel du 30-31/07/2026 (`docs/23-AUDIT-VISUEL.md` §2.1) : la même
   * méthode que `Factures.tsx` / `JournalAudit.tsx` (déjà propres) — des
   * pourcentages qui somment EXACTEMENT à 100 — est reprise ici.
   *
   * Douze colonnes restent beaucoup pour 1280 px : même la somme des seuls
   * EN-TÊTES (au jugé, ~7 px/caractère + 24 px de rembourrage) dépasse la
   * largeur réelle de la table (~1022 px mesurés).
   *
   * Mise à jour du 31/07/2026 (recette au navigateur,
   * docs/25-RECETTE-APRES-CAMPAGNE.md §5) : les deux en-têtes cités ci-dessus
   * étaient mesurés à 109 px (« Opportunité ? », 92 alloués) et 136 px
   * (« Rentabilité prévue », 92 alloués). Abrégés en « Opport. ? »
   * (`libelleLong` porte le mot entier en infobulle, même mécanisme que
   * `Concurrents.tsx`) et « Rentabilité » : ils ne réclament plus que 79 px
   * et 100 px. `famille` cède 1 point (9 % → 8 %, encore large pour son
   * besoin réel) et `rentabilite` en gagne un (9 % → 10 %) — seul changement
   * de largeur sur ce tableau, tous les autres en-têtes restant déjà à leur
   * minimum exact (aucune marge à reprendre nulle part). Les DIX colonnes
   * restantes n'ont donc PAS eu besoin de retirer une colonne : contrairement
   * à `Opportunites.tsx` (« Où aller ? »), l'abréviation seule a suffi ici.
   */
  const colonnes: ReadonlyArray<ColonneTableau<PropositionEvenement>> = [
    {
      // `repli` : c'est la colonne IDENTIFIANTE de la rangée (docs/07 §4.5,
      // « la colonne identifiante ne se tronque jamais »).
      cle: 'nom',
      libelle: 'Événement',
      largeur: '13%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (p) => p.nom,
      titre: (p) => p.nom,
    },
    {
      cle: 'type',
      libelle: 'Type',
      largeur: '7%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (p) => LIBELLE_TYPE[p.type],
    },
    {
      // `repli` : une plage de dates est un identifiant qualitatif — en perdre
      // la fin (« 24/12/20… ») est pire qu'un texte tronqué (docs/07 §4.5).
      cle: 'periode',
      libelle: 'Période',
      largeur: '8%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (p) => formaterPeriode(p.dateDebut, p.dateFin),
    },
    {
      cle: 'lieu',
      libelle: 'Lieu',
      largeur: '6%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (p) => p.lieuNom ?? '—',
    },
    {
      // `repli` : « à vol d'oiseau » n'est pas un ornement, c'est l'avertissement
      // que la fiche 05 impose pour ne jamais laisser croire à une distance de
      // trajet — il ne peut pas disparaître derrière une ellipse.
      cle: 'distance',
      libelle: 'Distance',
      largeur: '9%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (p) => formaterDistance(p.distanceKm),
      titre: (p) =>
        p.distanceKm === null
          ? 'Distance inconnue'
          : 'Estimée par la recherche, à vol d’oiseau — pas une distance routière.',
    },
    {
      cle: 'portee',
      libelle: 'Portée',
      largeur: '7%',
      alignement: 'texte',
      rendu: (p) => (
        <select
          aria-label={`Portée de « ${p.nom} »`}
          value={ajustements[p.id]?.portee ?? p.portee}
          onChange={(e) =>
            modifierAjustement(p.id, { portee: e.target.value as PorteeEvenementPropose })
          }
          onKeyDown={surEntreeValider(p)}
          disabled={enCoursId === p.id}
          className="h-controle w-full rounded-sm border border-line-field bg-surface px-1 text-sm text-ink"
        >
          {Object.entries(LIBELLE_PORTEE).map(([valeur, libelle]) => (
            <option key={valeur} value={valeur}>
              {libelle}
            </option>
          ))}
        </select>
      ),
    },
    {
      cle: 'intensite',
      libelle: 'Intensité',
      largeur: '8%',
      alignement: 'nombre',
      rendu: (p) => (
        <input
          aria-label={`Intensité de « ${p.nom} », de 1 à 5`}
          type="number"
          min={1}
          max={5}
          step={1}
          value={ajustements[p.id]?.intensiteEstimee ?? p.intensiteEstimee}
          onChange={(e) => {
            const valeur = Number.parseInt(e.target.value, 10);
            if (Number.isInteger(valeur) && valeur >= 1 && valeur <= 5) {
              modifierAjustement(p.id, { intensiteEstimee: valeur });
            }
          }}
          onKeyDown={surEntreeValider(p)}
          disabled={enCoursId === p.id}
          className="h-controle w-full rounded-sm border border-line-field bg-surface px-1 text-right text-sm text-ink"
        />
      ),
    },
    {
      // Fiche 14 : taguer une découverte comme une OPPORTUNITÉ (marché de
      // Noël, stand entreprise, grand public) AVANT de la valider — sans
      // quoi elle entre dans le calcul comme un simple facteur classique,
      // ce qui reste le comportement par défaut (« Aucune »).
      cle: 'famille',
      libelle: 'Opport. ?',
      libelleLong: 'Opportunité ?',
      largeur: '8%',
      alignement: 'texte',
      rendu: (p) => (
        <select
          aria-label={`Famille d’opportunité de « ${p.nom} »`}
          value={ajustements[p.id]?.famille ?? p.famille ?? ''}
          onChange={(e) =>
            modifierAjustement(p.id, {
              famille: (e.target.value === '' ? null : e.target.value) as FamilleOpportunitePropose,
            })
          }
          onKeyDown={surEntreeValider(p)}
          disabled={enCoursId === p.id}
          className="h-controle w-full rounded-sm border border-line-field bg-surface px-1 text-sm text-ink"
        >
          <option value="">Aucune (facteur classique)</option>
          {Object.entries(LIBELLE_FAMILLE).map(([valeur, libelle]) => (
            <option key={valeur} value={valeur}>
              {libelle}
            </option>
          ))}
        </select>
      ),
      titre: () =>
        'Voir docs/demandes/14 — une opportunité crée sa propre session, un facteur classique module La Batte.',
    },
    {
      cle: 'effectif',
      libelle: 'Effectif',
      largeur: '7%',
      alignement: 'nombre',
      rendu: (p) =>
        (ajustements[p.id]?.famille ?? p.famille) === 'entreprise' ? (
          <input
            aria-label={`Effectif estimé pour « ${p.nom} »`}
            type="number"
            min={0}
            step={1}
            value={ajustements[p.id]?.effectifEstime ?? ''}
            onChange={(e) => modifierAjustement(p.id, { effectifEstime: e.target.value })}
            onKeyDown={surEntreeValider(p)}
            disabled={enCoursId === p.id}
            className="h-controle w-full rounded-sm border border-line-field bg-surface px-1 text-right text-sm text-ink"
          />
        ) : (
          '—'
        ),
    },
    {
      cle: 'rentabilite',
      libelle: 'Rentabilité',
      libelleLong: 'Rentabilité prévue',
      largeur: '10%',
      alignement: 'nombre',
      rendu: (p) => (
        <span className={p.rentabiliteEstimeeCents >= 0 ? 'text-conforme' : 'text-depassement'}>
          {formaterRentabilite(p.rentabiliteEstimeeCents)}
        </span>
      ),
    },
    {
      cle: 'source',
      libelle: 'Source',
      largeur: '7%',
      alignement: 'texte',
      troncature: 'ellipse',
      rendu: (p) => p.source ?? '—',
      titre: (p) => p.source ?? '',
    },
    {
      // Empilés (`flex-col`) et non côte à côte : MESURÉ le 31/07/2026, deux
      // boutons « Valider »/« Rejeter » en ligne ont besoin de ~150-160 px,
      // largement plus que ce que 12 colonnes peuvent allouer à une seule —
      // « Rejeter » débordait hors du viewport. Empilés, chacun tient dans la
      // largeur d'un seul bouton.
      cle: 'actions',
      libelle: 'Actions',
      largeur: '10%',
      alignement: 'texte',
      rendu: (p) => (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => void valider(p)}
            disabled={enCoursId === p.id}
            className="h-controle w-full rounded-sm bg-accent px-2 text-xs font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            Valider
          </button>
          <button
            type="button"
            onClick={() => void rejeter(p)}
            disabled={enCoursId === p.id}
            className="h-controle w-full rounded-sm border border-line-field px-2 text-xs text-ink-2 hover:bg-surface-sunken disabled:opacity-50"
          >
            Rejeter
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-bloc">
      <div className="flex h-barre items-center justify-between">
        <h1 className="text-lg text-ink">Propositions d’événements (IA)</h1>
      </div>

      <Panneau titre="Chercher des événements">
        <div className="flex flex-wrap items-end gap-bloc">
          <div className="flex flex-col gap-1">
            <label htmlFor="lieu-recherche" className="text-xs text-ink-3">
              Lieu
            </label>
            <select
              id="lieu-recherche"
              value={lieuId}
              onChange={(e) => setLieuId(e.target.value)}
              className="h-controle rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
            >
              {lieux.length === 0 && <option value="">Aucun lieu actif</option>}
              {lieux.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nom}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="rayon-recherche" className="text-xs text-ink-3">
              Rayon de recherche
            </label>
            <select
              id="rayon-recherche"
              value={lieuActuel?.rayonRechercheEvenementsKm ?? ''}
              onChange={(e) => void changerRayon(Number(e.target.value) as RayonRechercheKm)}
              disabled={lieuActuel === null}
              className="h-controle rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
            >
              {DOMAINE_RAYON_RECHERCHE_KM.map((km) => (
                <option key={km} value={km}>
                  {km} km
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => void chercherEvenements()}
            disabled={lieuActuel === null || etatRecherche.statut === 'recherche'}
            className="h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {etatRecherche.statut === 'recherche' ? 'Recherche…' : 'Chercher des événements'}
          </button>
        </div>

        <p className="mt-2 text-xs text-ink-3">
          Déclenchement manuel : ce projet n’a pas de tâche planifiée automatique. Le rayon ne
          filtre PAS par région administrative — un rayon de 100 km autour de Liège atteint aussi
          Maastricht et Aix-la-Chapelle.
        </p>
        <p className="mt-1 text-xs text-ink-3">
          Un marché de Noël, un stand entreprise ou une fête médiévale ne dopent pas La Batte : ce
          sont des sessions à part, avec leur propre trajet et leur propre marge. Marquez une
          découverte comme « Opportunité » ci-dessous avant de la valider pour la voir apparaître
          dans « Où aller ? ».
        </p>

        {/*
          Registre TECHNIQUE, pas métier (correctif du 01/08/2026).

          `chargerLieux` échoue pour des raisons purement techniques : le
          serveur n'a pas répondu, ou a rendu un 500. Le porteur n'a AUCUN
          geste à faire. Ce message était pourtant rendu en `text-depassement`
          — la couleur du registre d'alerte MÉTIER, celle d'une rupture de
          stock ou d'un seuil légal franchi. Mélanger les deux dilue le seul
          signal qui doit rester rare (voir l'en-tête de `MessageErreur`,
          `../composants/EncartErreur`).

          Que ce fût un oubli et non une décision se lisait dans CE fichier :
          trente lignes plus bas, l'échec de chargement de la LISTE passe déjà
          par `MessageErreur`, en registre neutre. Deux pannes de même nature,
          deux registres, dans un seul écran. Les voici alignées.

          Le message reste DIT : un « Aucun lieu actif » muet se lirait comme
          une vraie liste vide alors que l'appel réseau a simplement échoué.
        */}
        {erreurLieux !== null && (
          <div className="mt-2">
            <MessageErreur message={erreurLieux} />
          </div>
        )}

        {etatRecherche.statut === 'succes' && (
          <p role="status" className="mt-2 text-sm text-conforme">
            {etatRecherche.nombre === 0
              ? 'Recherche terminée : aucun événement trouvé.'
              : `${etatRecherche.nombre} proposition(s) ajoutée(s) à la liste ci-dessous.`}
          </p>
        )}
        {etatRecherche.statut === 'indisponible' && (
          <p role="status" className="mt-2 text-sm text-ink-2">
            {etatRecherche.raison}
          </p>
        )}
        {etatRecherche.statut === 'erreur' && (
          <p role="alert" className="mt-2 text-sm text-depassement">
            {etatRecherche.message}
          </p>
        )}
      </Panneau>

      {etatListe.statut === 'chargement' && (
        <p className="text-sm text-ink-3">Chargement des propositions…</p>
      )}

      {etatListe.statut === 'erreur' && <MessageErreur message={etatListe.message} />}

      {etatListe.statut === 'pret' && (
        <Panneau titre={`${etatListe.total} proposition(s) en attente`} sansRembourrage>
          <Tableau
            colonnes={colonnes}
            lignes={etatListe.propositions}
            cleLigne={(p) => p.id}
            etatVide={
              <EtatVide
                variante="premier-lancement"
                titre="Aucune proposition en attente"
                explication="Cherchez des événements pour un lieu ci-dessus, ou saisissez un événement manuellement dans Événements."
              />
            }
          />
        </Panneau>
      )}
    </div>
  );
}
