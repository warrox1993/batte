import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  TIRET_ABSENT,
  estPremierPassage,
  formaterDate,
  formaterMontant,
  ouTiret,
  schemaListeLieux,
  type Evenement,
  type FiabiliteLieuContrat,
} from '@batte/core';
import {
  schemaListeOpportunites,
  type FamilleOpportuniteContrat,
  type LigneOpportunite,
  type ListeOpportunites,
  // Import relatif temporaire : contrat neuf, hors des barrels `@batte/core` /
  // `@batte/db` tant que l'orchestrateur ne les a pas câblés — voir le
  // rapport de livraison pour les lignes exactes à y ajouter. Même
  // convention que `apps/web/src/pages/PropositionsEvenements.tsx` (fiche 05)
  // avant son câblage.
} from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { MessageErreur } from '../composants/EncartErreur';
import { EnveloppeChamp } from '../composants/champs-formulaire';
import { ErreurApi, requeteApi, type ChampsEnErreur } from '../lib/api';

/**
 * Écran « Où aller ? » (docs/demandes/14-EVENEMENTS-COMME-OPPORTUNITES.md).
 *
 * Aucun calcul métier ici (CLAUDE.md §3 règle 1) : fréquentation, coûts et
 * marge nette viennent TELS QUELS de `/api/opportunites`, qui compose
 * `packages/core/src/opportunites.ts` (fiche 14) et
 * `packages/core/src/deplacement.ts` (fiche 13).
 *
 * LA FIABILITÉ N'EST PAS DÉCORATIVE (fiche 14 §6) : une prévision pour un
 * lieu jamais visité ne vaut pas une prévision pour La Batte. Cet écran ne
 * re-trie jamais les lignes (le serveur classe déjà par marge nette
 * décroissante, marge inconnue en fin de liste — et, PARMI les lignes à marge
 * inconnue, par coût connu croissant, voir D-082 ci-dessous), mais affiche la
 * fiabilité en clair à côté de chaque fréquentation prévue.
 *
 * TROIS FAMILLES, TROIS LOGIQUES (fiche 14 §3) : « entreprise » ne se prévoit
 * jamais comme « grand public »/« marché de Noël ». Un stand entreprise reste
 * silencieux tant qu'aucun taux de prise n'a été mesuré (D-059) — ce n'est
 * pas une case vide oubliée, c'est le comportement honnête tant que
 * l'observation n'existe pas.
 *
 * D-082 (`docs/05-DECISIONS.md`, décidée le 31/07/2026) : pour un grand
 * public / marché de Noël jamais visité (zéro session close sur le lieu),
 * AUCUN chiffre n'est inventé à partir de l'estimation de départ — les
 * colonnes « CA attendu (€) » et « Marge nette attendue (€) » portent un
 * tiret ET la mention « premier passage » (jamais un tiret nu, qui se lirait
 * comme un oubli de saisie). Le tri, lui, ne fait JAMAIS remonter ces lignes
 * par un revenu supposé — voir `apps/api/src/routes/opportunites.ts` pour le
 * départage par coût connu.
 */

type TypeEvenementOpportunite = Evenement['type'];

const LIBELLE_TYPE: Readonly<Record<TypeEvenementOpportunite, string>> = {
  festival: 'Festival',
  ferie: 'Jour férié',
  sportif: 'Événement sportif',
  meteo_exceptionnelle: 'Météo exceptionnelle',
  greve: 'Grève',
  travaux: 'Travaux',
  concurrence: 'Concurrence',
  autre: 'Autre',
};

const LIBELLE_FAMILLE: Readonly<Record<FamilleOpportuniteContrat, string>> = {
  grand_public: 'Grand public',
  entreprise: 'Entreprise',
  marche_noel: 'Marché de Noël',
};

const LIBELLES_FIABILITE: Readonly<Record<FiabiliteLieuContrat, string>> = {
  aucune_donnee: 'Aucune donnée — jamais visité',
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

function libelleFiabilite(ligne: LigneOpportunite): string {
  const base = LIBELLES_FIABILITE[ligne.fiabilite];
  const nb = ligne.nbSessionsRetenues;
  return nb === 0 ? base : `${base} (${nb} session${nb > 1 ? 's' : ''})`;
}

function formaterPeriode(dateDebut: string, dateFin: string): string {
  return dateDebut === dateFin
    ? formaterDate(dateDebut)
    : `${formaterDate(dateDebut)} – ${formaterDate(dateFin)}`;
}

/**
 * Attribution obligatoire (licence CC-BY 4.0) : quand `distanceEstimeeVolDoiseau`
 * est faux, la colonne « Distance » ci-dessous rend `lieu_marche.distance_km`,
 * qui peut avoir été calculée automatiquement par OpenRouteService à partir de
 * données OpenStreetMap (`apps/api/src/itineraire/client.ts`). L'estimation à
 * vol d'oiseau (repli sans lieu rattaché) n'en dérive PAS — elle vient d'un
 * calcul géométrique indépendant, jamais d'OpenRouteService.
 */
const MENTION_ATTRIBUTION_DISTANCE =
  'Distance routière calculée automatiquement via OpenRouteService, © contributeurs ' +
  'OpenStreetMap (CC BY 4.0), ou saisie manuellement — sauf mention « à vol d’oiseau », ' +
  'une simple estimation indépendante de ce service.';

/** `≈ 33 km à vol d'oiseau` — jamais laisser croire à une distance routière (fiche 05/13). */
function formaterDistance(ligne: LigneOpportunite): string {
  if (ligne.distanceKm === null) return TIRET_ABSENT;
  const arrondie = Math.round(ligne.distanceKm * 10) / 10;
  return ligne.distanceEstimeeVolDoiseau
    ? `≈ ${arrondie.toLocaleString('fr-BE')} km à vol d’oiseau`
    : `${arrondie.toLocaleString('fr-BE')} km`;
}

/**
 * `0,4761 €/km` — QUATRE décimales, jamais deux. `meta.coutKilometriqueCentsParKm`
 * (`schemaListeOpportunites`, `packages/core/src/contrats/opportunites.ts:79`)
 * est un TAUX fractionnaire (le barème kilométrique belge officiel s'exprime
 * avec quatre décimales, ex. 47,61 centimes/km), pas un montant entier de
 * centimes : `formaterMontant`/`formaterEuros` (deux décimales, pour de
 * l'argent réellement encaissé ou dépensé) l'arrondiraient à `0,48 €/km` et
 * feraient disparaître le dernier chiffre du barème officiel — CLAUDE.md §3
 * (« argent en centimes entiers ») vise les MONTANTS, pas un taux au km.
 */
function formaterTauxKilometrique(centsParKm: number): string {
  return `${(centsParKm / 100).toFixed(4).replace('.', ',')} €/km`;
}

/**
 * Le taux kilométrique retenu pour TOUTE la liste, et sa source — pas
 * décoratif : c'est ce taux qui produit `coutDeplacementCents` sur CHAQUE
 * ligne (colonne « Déplacement (€) » ci-dessous). `meta.coutKilometriqueCentsParKm`
 * et `meta.coutKilometriqueSource` étaient calculés, testés, servis par
 * `GET /opportunites`, et jamais lus par cet écran (audit du 31/07/2026) :
 * zéro occurrence de `coutKilometrique` avant ce correctif, bien que le champ
 * DE MÊME NOM soit affiché ailleurs (`ComparaisonLieux.tsx`, sur la route
 * `/lieux-rentabilite` — un champ homonyme, pas le même, qui a fait échapper
 * celui-ci à un premier passage par recherche textuelle). Sans cette phrase,
 * le porteur voit un coût de déplacement par ligne sans jamais savoir à quel
 * taux il a été calculé, ni si ce taux vient d'un barème officiel ou d'une
 * valeur par défaut non confirmée.
 *
 * `source` vide (`definitionParametre(...)?.source ?? ''`, `apps/api/src/
 * routes/opportunites.ts`) est un repli défensif, pas un cas attendu en
 * usage réel : tout paramètre déclare une source (CLAUDE.md §7). La parenthèse
 * est alors simplement omise plutôt que d'afficher des parenthèses vides.
 */
export function phraseCoutKilometrique(meta: {
  readonly coutKilometriqueCentsParKm: number;
  readonly coutKilometriqueSource: string;
}): string {
  const taux = formaterTauxKilometrique(meta.coutKilometriqueCentsParKm);
  return meta.coutKilometriqueSource === ''
    ? `Coût de déplacement calculé à ${taux}.`
    : `Coût de déplacement calculé à ${taux} (${meta.coutKilometriqueSource}).`;
}

function formaterFrequentation(ligne: LigneOpportunite): string {
  if (ligne.crepesPrevuesTotal === null) return TIRET_ABSENT;
  return ligne.nbSessions > 1
    ? `${ligne.crepesPrevuesTotal} (${ligne.crepesPrevuesParSession}/jour × ${ligne.nbSessions})`
    : String(ligne.crepesPrevuesTotal);
}

/**
 * D-082 : vrai UNIQUEMENT pour un grand public / marché de Noël dont le LIEU
 * n'a encore reçu aucune session close. Exclut délibérément « entreprise » :
 * `nbSessionsRetenues` y compte des sessions déjà tenues CHEZ CETTE
 * entreprise (taux de prise, D-059) — une toute autre absence, déjà dite par
 * l'avertissement dédié au-dessus du tableau, jamais par la mention
 * « premier passage » ci-dessous.
 */
export function estPremierPassageLigne(ligne: LigneOpportunite): boolean {
  return ligne.famille !== 'entreprise' && estPremierPassage(ligne.nbSessionsRetenues);
}

/**
 * Cellule CA/marge : un tiret NU se lit comme un oubli de saisie. Pour un
 * premier passage (D-082), la mention dit POURQUOI aucun chiffre n'existe —
 * jamais une prévision de zéro, jamais un tiret silencieux non plus.
 */
export function celluleMontantOuTiret(
  valeurCents: number | null,
  ligne: LigneOpportunite,
): ReactNode {
  if (valeurCents !== null) return formaterMontant(valeurCents);
  return (
    <span className="text-ink-3">
      {TIRET_ABSENT}
      {estPremierPassageLigne(ligne) && (
        <span className="ml-1 text-2xs uppercase">premier passage</span>
      )}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Lieux — pour le sélecteur de rattachement et de création
   ═══════════════════════════════════════════════════════════════════════════ */

type LieuOption = { readonly id: string; readonly nom: string };

/* ═══════════════════════════════════════════════════════════════════════════
   États de chargement
   ═══════════════════════════════════════════════════════════════════════════ */

type EtatListe =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; donnees: ListeOpportunites };

const DELAI_SUCCES_MS = 6000;

export default function Opportunites() {
  const [etat, setEtat] = useState<EtatListe>({ statut: 'chargement' });
  const [lieux, setLieux] = useState<LieuOption[]>([]);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [enCoursId, setEnCoursId] = useState<string | null>(null);
  const [messageAction, setMessageAction] = useState<
    { statut: 'succes'; texte: string } | { statut: 'erreur'; texte: string } | null
  >(null);

  const boutonBascule = useRef<HTMLButtonElement>(null);

  const charger = useCallback(async (): Promise<void> => {
    try {
      const brut = await requeteApi<unknown>('/opportunites');
      setEtat({ statut: 'pret', donnees: schemaListeOpportunites.parse(brut) });
    } catch (erreur) {
      setEtat({
        statut: 'erreur',
        message:
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
      });
    }
  }, []);

  const chargerLieux = useCallback(async (): Promise<void> => {
    try {
      const brut = await requeteApi<unknown>('/lieux');
      setLieux(schemaListeLieux.parse(brut).data);
    } catch {
      // Un lieu non chargé désactive simplement les sélecteurs de rattachement
      // et de création : la liste des opportunités déjà connues reste,
      // elle, consultable (mode dégradé).
      setLieux([]);
    }
  }, []);

  useEffect(() => {
    void charger();
    void chargerLieux();
  }, [charger, chargerLieux]);

  useEffect(() => {
    if (formulaireOuvert) document.getElementById('opp-nom')?.focus();
  }, [formulaireOuvert]);

  useEffect(() => {
    if (!formulaireOuvert) return;
    function surAppuiTouche(evenement: KeyboardEvent): void {
      if (evenement.key !== 'Escape') return;
      setFormulaireOuvert(false);
      boutonBascule.current?.focus();
    }
    window.addEventListener('keydown', surAppuiTouche);
    return () => window.removeEventListener('keydown', surAppuiTouche);
  }, [formulaireOuvert]);

  useEffect(() => {
    if (messageAction === null) return undefined;
    const minuteur = window.setTimeout(() => setMessageAction(null), DELAI_SUCCES_MS);
    return () => window.clearTimeout(minuteur);
  }, [messageAction]);

  async function rejeter(ligne: LigneOpportunite): Promise<void> {
    setEnCoursId(ligne.id);
    try {
      await requeteApi(`/opportunites/${ligne.id}/rejeter`, { method: 'POST' });
      setMessageAction({ statut: 'succes', texte: `« ${ligne.nom} » écartée.` });
      await charger();
    } catch (erreur) {
      setMessageAction({
        statut: 'erreur',
        texte: erreur instanceof ErreurApi ? erreur.message : 'Le rejet a échoué.',
      });
    } finally {
      setEnCoursId(null);
    }
  }

  async function rattacherLieu(ligne: LigneOpportunite, lieuId: string): Promise<void> {
    if (lieuId === '') return;
    setEnCoursId(ligne.id);
    try {
      await requeteApi(`/opportunites/${ligne.id}/rattacher-lieu`, {
        method: 'PATCH',
        body: JSON.stringify({ lieuId }),
      });
      setMessageAction({ statut: 'succes', texte: `Lieu rattaché à « ${ligne.nom} ».` });
      await charger();
    } catch (erreur) {
      setMessageAction({
        statut: 'erreur',
        texte: erreur instanceof ErreurApi ? erreur.message : 'Le rattachement a échoué.',
      });
    } finally {
      setEnCoursId(null);
    }
  }

  const colonnes: ReadonlyArray<ColonneTableau<LigneOpportunite>> = [
    {
      // 12 colonnes sur ce tableau, la limite pratique de 1280 px (docs/07
      // §4.4) — les largeurs ci-dessous sont un rééquilibrage mesuré, pas une
      // preuve que 12 colonnes tiennent confortablement. Voir le rapport de
      // la mission du 31/07/2026 : les pourcentages d'origine sommaient à
      // 128 %, symptôme d'un écran construit colonne par colonne sans
      // revérifier le total.
      //
      // MISE À JOUR DU 31/07/2026 (recette au navigateur,
      // docs/25-RECETTE-APRES-CAMPAGNE.md §5) : rééquilibrer une deuxième
      // fois ne suffisait plus — 6 en-têtes sur 12 restaient tronqués, pire
      // cas 82 px disponibles pour 178 px requis (« Marge nette attendue
      // (€) »). Structurellement trop de colonnes pour 1280 px : la vraie
      // réponse était d'en RETIRER ou FUSIONNER une, pas de continuer à
      // chipoter les pourcentages. Deux pistes évaluées :
      //
      // 1. Retirer « Lieu » — REJETÉ. L'idée reposait sur un « sélecteur de
      //    lieu juste au-dessus » qui rendrait la colonne redondante tant
      //    qu'on ne mélange pas plusieurs lieux. Aucun tel sélecteur n'existe
      //    sur cet écran : chaque ligne compare une opportunité DIFFÉRENTE,
      //    avec son propre lieu ou sa propre commune (`l.lieuNom ??
      //    l.communeTexte`) — c'est un tableau de COMPARAISON entre lieux par
      //    construction, jamais filtré sur un seul. La condition même de
      //    l'idée (« tant qu'on ne mélange pas plusieurs lieux ») est violée
      //    ici en permanence. Retirer cette colonne sur l'écran qui répond
      //    littéralement à « où aller ? » en supprimerait la réponse.
      //
      // 2. Fusionner « Déplacement (€) » + « Emplacement (€) » en « Frais
      //    (€) » — RETENU, mais PAS comme une somme. Un total calculé
      //    exigerait une décision métier sur le cas où un seul des deux
      //    coûts est connu (`coutEmplacementCents` peut être `null` avec un
      //    motif, `coutEmplacementIndisponibleRaison`) : afficher un total
      //    fondé sur un seul des deux masquerait silencieusement le second,
      //    exactement ce que docs/07 §4.5 interdit (« zéro et inconnu ne
      //    s'écrivent pas pareil »). Un tel total appartiendrait à
      //    `packages/core`, hors du périmètre d'écriture de cette mission.
      //    La colonne fusionnée ci-dessous se contente donc de JUXTAPOSER
      //    les deux montants déjà calculés côté serveur, séparés par « / »,
      //    sans inventer de calcul ni changer un montant — « frais » est
      //    d'ailleurs déjà le terme générique de la fiche 13
      //    (docs/demandes/13-COUT-COMPLET-ET-ARBITRAGE-ENTRE-LIEUX.md §3,
      //    « matière, déplacement, emplacement, gaz, assurance »).
      //
      // Les en-têtes « Crêpes prévues », « CA attendu (€) » et « Marge nette
      // attendue (€) » sont en plus abrégés (`libelleLong` porte le libellé
      // complet en infobulle, même mécanisme que `Concurrents.tsx` /
      // `PropositionsEvenements.tsx`) : la fusion seule ramène le tableau à
      // 11 colonnes, mais ne suffisait pas encore à loger ces trois-là.
      cle: 'nom',
      libelle: 'Opportunité',
      largeur: '15%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (l) => l.nom,
      titre: (l) => l.nom,
    },
    {
      // « Marché de Noël » (14 caractères) se coupait sans aucun recours —
      // ni `repli` ni `titre` — à 9 %. Ajout des deux.
      cle: 'famille',
      libelle: 'Famille',
      largeur: '7%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (l) => LIBELLE_FAMILLE[l.famille],
      titre: (l) => LIBELLE_FAMILLE[l.famille],
    },
    {
      cle: 'periode',
      libelle: 'Période',
      largeur: '9%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (l) => formaterPeriode(l.dateDebut, l.dateFin),
      titre: (l) => (l.nbSessions > 1 ? `${l.nbSessions} sessions (une par jour)` : ''),
    },
    {
      // NON retiré — voir le commentaire de la colonne « Opportunité »
      // ci-dessus : cet écran compare des opportunités à des lieux
      // DIFFÉRENTS, cette colonne EST la réponse à « où aller ? ».
      cle: 'lieu',
      libelle: 'Lieu',
      largeur: '7%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (l) => l.lieuNom ?? l.communeTexte ?? TIRET_ABSENT,
    },
    {
      // « ≈ 3 km à vol d'oiseau » (≈ 21 caractères) n'avait ni `repli` ni
      // `titre` répétant le texte rendu — seulement un `titre` conditionnel
      // portant un tout autre message (la mise en garde vol d'oiseau).
      // `repli` couvre maintenant le texte lui-même ; la mise en garde reste
      // au clic/survol via `titre`. 8 % (au lieu de 7) : l'en-tête
      // « Distance » lui-même débordait de peu (77 px requis, 72 alloués).
      cle: 'distance',
      libelle: 'Distance',
      largeur: '8%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: formaterDistance,
      titre: (l) =>
        l.distanceEstimeeVolDoiseau
          ? 'Estimation à vol d’oiseau : sous-estime probablement la distance routière réelle.'
          : '',
    },
    {
      cle: 'fiabilite',
      libelle: 'Fiabilité',
      largeur: '9%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (l) => <span className={CLASSES_FIABILITE[l.fiabilite]}>{libelleFiabilite(l)}</span>,
      titre: (l) => l.explicationPrevision,
    },
    {
      cle: 'crepes',
      libelle: 'Crêpes',
      libelleLong: 'Crêpes prévues',
      largeur: '7%',
      alignement: 'nombre',
      troncature: 'repli',
      rendu: (l) => formaterFrequentation(l),
      titre: (l) => l.explicationPrevision,
    },
    {
      // L'unité va dans l'en-tête, pas répétée en cellule (docs/07 §4.5,
      // mission du 31/07/2026) — la cellule utilisait déjà `formaterMontant`
      // (pas de doublon), mais l'en-tête ne portait l'unité nulle part.
      // `repli` : mesuré à l'écran (recette du 31/07/2026) — à 6 % un CA de
      // « 801,04 » débordait déjà d'1 px et s'affichait « 801,… », un NOMBRE
      // tronqué, strictement interdit (docs/07 §4.5). 7 % + `repli` en filet
      // de sécurité pour tout montant plus grand encore.
      cle: 'ca',
      libelle: 'CA (€)',
      libelleLong: 'CA attendu (€)',
      largeur: '7%',
      alignement: 'nombre',
      troncature: 'repli',
      rendu: (l) => celluleMontantOuTiret(l.caAttenduCents, l),
      titre: (l) => (estPremierPassageLigne(l) ? l.explicationPrevision : ''),
    },
    {
      // FUSION de « Déplacement (€) » et « Emplacement (€) » — voir le
      // commentaire de la colonne « Opportunité » ci-dessus pour la décision
      // complète. Les deux montants restent CALCULÉS TELS QUELS par le
      // serveur (`ouTiret`/`formaterMontant`, jamais additionnés ici) et
      // restent tous deux LISIBLES dans la cellule ; seule leur PLACE à
      // l'écran change. `repli`, comme sur toute colonne numérique de ce
      // tableau : un montant ne se tronque jamais, il replie plutôt.
      cle: 'frais',
      libelle: 'Frais (€)',
      libelleLong: 'Déplacement et emplacement (€)',
      largeur: '11%',
      alignement: 'nombre',
      troncature: 'repli',
      rendu: (l) => (
        <span className="tabular-nums">
          {ouTiret(l.coutDeplacementCents, formaterMontant)}
          {' / '}
          {ouTiret(l.coutEmplacementCents, formaterMontant)}
        </span>
      ),
      titre: (l) => {
        const deplacement = ouTiret(l.coutDeplacementCents, formaterMontant);
        const emplacement = ouTiret(l.coutEmplacementCents, formaterMontant);
        const raison = l.coutEmplacementIndisponibleRaison;
        return (
          `${deplacement} / ${emplacement} — Déplacement / Emplacement` +
          (raison !== null ? ` (${raison})` : '')
        );
      },
    },
    {
      cle: 'marge',
      libelle: 'Marge (€)',
      libelleLong: 'Marge nette attendue (€)',
      largeur: '9%',
      alignement: 'nombre',
      // `repli`, même raison que `ca` ci-dessus : un montant ne se tronque
      // jamais, il replie plutôt s'il devait un jour manquer de place.
      troncature: 'repli',
      rendu: (l) =>
        l.margeNetteAttendueCents === null ? (
          celluleMontantOuTiret(null, l)
        ) : (
          <span className="font-medium tabular-nums text-ink">
            {formaterMontant(l.margeNetteAttendueCents)}
          </span>
        ),
      titre: (l) => (estPremierPassageLigne(l) ? l.explicationPrevision : ''),
    },
    {
      // 11 % (au lieu de 12) : mesuré, le bouton « Écarter » seul ne réclame
      // que 53 px — la marge cédée ici finance le point gagné par `ca`
      // ci-dessus, seule colonne qui manquait réellement de place une fois
      // les en-têtes tous casés.
      cle: 'actions',
      libelle: 'Actions',
      largeur: '11%',
      alignement: 'texte',
      rendu: (l) => (
        <div className="flex items-center gap-groupe">
          {l.lieuId === null && lieux.length > 0 && (
            <select
              aria-label={`Rattacher un lieu à « ${l.nom} »`}
              defaultValue=""
              disabled={enCoursId === l.id}
              onChange={(e) => void rattacherLieu(l, e.target.value)}
              className="h-controle rounded-sm border border-line-field bg-surface px-1 text-xs text-ink"
            >
              <option value="">Rattacher un lieu…</option>
              {lieux.map((lieu) => (
                <option key={lieu.id} value={lieu.id}>
                  {lieu.nom}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => void rejeter(l)}
            disabled={enCoursId === l.id}
            className="h-controle rounded-sm border border-line-field px-2 text-xs text-ink-2 hover:bg-surface-sunken disabled:opacity-50"
          >
            Écarter
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-bloc">
      <div className="flex h-barre items-center justify-between">
        <h1 className="text-lg text-ink">Où aller ?</h1>
        <button
          type="button"
          ref={boutonBascule}
          onClick={() => setFormulaireOuvert((ouvert) => !ouvert)}
          aria-expanded={formulaireOuvert}
          className={
            formulaireOuvert
              ? 'h-controle rounded-sm border border-line-field px-3 text-sm text-ink-2 hover:bg-surface-sunken'
              : 'h-controle rounded-sm bg-accent px-3 text-sm text-on-accent hover:bg-accent-hover'
          }
        >
          {formulaireOuvert ? 'Fermer le formulaire' : 'Nouvelle opportunité'}
        </button>
      </div>

      <p className="text-xs text-ink-3">
        Un marché de Noël, un stand d’entreprise, une fête médiévale : des sessions qui
        n’existeraient pas sans eux, avec leur propre trajet, leur propre emplacement, leur propre
        marge nette. Classées par marge nette attendue, déplacement compris — les lignes à marge
        inconnue restent en fin de liste, jamais en tête, et sont elles-mêmes classées par coût
        connu croissant : jamais par un revenu supposé.
      </p>
      <p className="text-xs text-ink-3">{MENTION_ATTRIBUTION_DISTANCE}</p>

      {messageAction !== null && (
        <p
          role={messageAction.statut === 'erreur' ? 'alert' : 'status'}
          className={`text-sm ${messageAction.statut === 'erreur' ? 'text-depassement' : 'text-conforme'}`}
        >
          {messageAction.texte}
        </p>
      )}

      {etat.statut === 'chargement' && (
        <p className="text-sm text-ink-3">Chargement des opportunités…</p>
      )}

      {etat.statut === 'erreur' && <MessageErreur message={etat.message} />}

      {etat.statut === 'pret' && (
        <div className="flex flex-col items-start gap-bloc lg:flex-row">
          <div className="min-w-0 flex-1 self-stretch">
            {!etat.donnees.meta.coutsDisponibles &&
              etat.donnees.meta.avertissementCouts !== null && (
                <div
                  role="alert"
                  className="mb-groupe border-l-2 border-alerte bg-alerte-bg px-3 py-2 text-sm text-alerte"
                >
                  {etat.donnees.meta.avertissementCouts}
                </div>
              )}
            {etat.donnees.meta.avertissementTauxPriseEntreprise !== null && (
              <div className="mb-groupe border-l-2 border-line-strong bg-surface-sunken px-3 py-2 text-sm text-ink-2">
                {etat.donnees.meta.avertissementTauxPriseEntreprise}
              </div>
            )}

            <p className="mb-groupe text-xs text-ink-3">
              {phraseCoutKilometrique(etat.donnees.meta)}
            </p>

            <Panneau
              titre={`${etat.donnees.meta.total} opportunité${etat.donnees.meta.total > 1 ? 's' : ''}`}
              sansRembourrage
            >
              <Tableau
                colonnes={colonnes}
                lignes={etat.donnees.data}
                cleLigne={(l) => l.id}
                etatVide={
                  <EtatVide
                    variante="premier-lancement"
                    titre="Aucune opportunité enregistrée"
                    explication="Un marché de Noël, un stand entreprise ou une fête médiévale ne se voient pas tant qu’ils n’ont pas été créés ici, ou validés depuis Propositions IA (événements) avec une famille renseignée."
                    action={{
                      libelle: 'Créer une opportunité',
                      onClick: () => setFormulaireOuvert(true),
                    }}
                  />
                }
              />
            </Panneau>
          </div>

          {formulaireOuvert && (
            <div className="w-full lg:w-[22.5rem] lg:shrink-0">
              <Panneau titre="Nouvelle opportunité">
                <FormulaireOpportunite
                  lieux={lieux}
                  onCree={() => {
                    void charger();
                  }}
                />
              </Panneau>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Formulaire de création
   ═══════════════════════════════════════════════════════════════════════════ */

type Brouillon = {
  nom: string;
  type: TypeEvenementOpportunite;
  famille: FamilleOpportuniteContrat;
  dateDebut: string;
  dateFin: string;
  communeTexte: string;
  lieuId: string;
  distanceKm: string;
  effectifEstime: string;
  source: string;
  notes: string;
};

const BROUILLON_INITIAL: Brouillon = {
  nom: '',
  type: 'festival',
  famille: 'grand_public',
  dateDebut: '',
  dateFin: '',
  communeTexte: '',
  lieuId: '',
  distanceKm: '',
  effectifEstime: '',
  source: '',
  notes: '',
};

const CLASSE_CHAMP_BASE =
  'w-full rounded-sm border border-line-field bg-surface px-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';
const CLASSE_CHAMP = `h-controle ${CLASSE_CHAMP_BASE}`;
const CLASSE_CHAMP_TEXTAREA = `${CLASSE_CHAMP_BASE} resize-none py-1`;

const ORDRE_CHAMPS = [
  'opp-nom',
  'opp-type',
  'opp-famille',
  'opp-dateDebut',
  'opp-dateFin',
  'opp-communeTexte',
  'opp-lieuId',
  'opp-distanceKm',
  'opp-effectifEstime',
  'opp-source',
  'opp-notes',
  '_global',
] as const;

function focaliserPremierChampEnErreur(champs: ChampsEnErreur): void {
  for (const cle of ORDRE_CHAMPS) {
    if (cle in champs) {
      document.getElementById(cle)?.focus();
      return;
    }
  }
}

type EtatEnvoi =
  | { statut: 'inactif' }
  | { statut: 'envoi' }
  | { statut: 'succes' }
  | { statut: 'erreur'; message: string };

function FormulaireOpportunite({ lieux, onCree }: { lieux: LieuOption[]; onCree: () => void }) {
  const [brouillon, setBrouillon] = useState<Brouillon>(BROUILLON_INITIAL);
  const [champs, setChamps] = useState<ChampsEnErreur>({});
  const [envoi, setEnvoi] = useState<EtatEnvoi>({ statut: 'inactif' });

  useEffect(() => {
    if (envoi.statut !== 'succes') return undefined;
    const minuteur = window.setTimeout(() => setEnvoi({ statut: 'inactif' }), DELAI_SUCCES_MS);
    return () => window.clearTimeout(minuteur);
  }, [envoi]);

  async function soumettre(evenement: FormEvent<HTMLFormElement>): Promise<void> {
    evenement.preventDefault();
    setChamps({});
    setEnvoi({ statut: 'envoi' });

    const distanceKm =
      brouillon.distanceKm.trim() === '' ? null : Number(brouillon.distanceKm.replace(',', '.'));
    const effectifEstime =
      brouillon.effectifEstime.trim() === '' ? null : Number.parseInt(brouillon.effectifEstime, 10);

    try {
      await requeteApi('/opportunites', {
        method: 'POST',
        body: JSON.stringify({
          nom: brouillon.nom,
          type: brouillon.type,
          famille: brouillon.famille,
          dateDebut: brouillon.dateDebut,
          dateFin: brouillon.dateFin,
          communeTexte: brouillon.communeTexte.trim() === '' ? null : brouillon.communeTexte.trim(),
          lieuId: brouillon.lieuId === '' ? null : brouillon.lieuId,
          distanceKm,
          effectifEstime,
          source: brouillon.source.trim() === '' ? null : brouillon.source.trim(),
          notes: brouillon.notes.trim() === '' ? null : brouillon.notes.trim(),
        }),
      });
      setEnvoi({ statut: 'succes' });
      setBrouillon(BROUILLON_INITIAL);
      onCree();
      document.getElementById('opp-nom')?.focus();
    } catch (erreur) {
      if (erreur instanceof ErreurApi && erreur.champs !== undefined) {
        setChamps(erreur.champs);
        focaliserPremierChampEnErreur(erreur.champs);
      }
      setEnvoi({
        statut: 'erreur',
        message: erreur instanceof ErreurApi ? erreur.message : 'La création a échoué.',
      });
    }
  }

  return (
    <form onSubmit={(e) => void soumettre(e)} className="flex flex-col gap-bloc">
      <EnveloppeChamp id="opp-nom" label="Nom" erreur={champs['nom']}>
        <input
          id="opp-nom"
          type="text"
          required
          value={brouillon.nom}
          onChange={(e) => setBrouillon((b) => ({ ...b, nom: e.target.value }))}
          className={CLASSE_CHAMP}
        />
      </EnveloppeChamp>

      <EnveloppeChamp id="opp-famille" label="Famille" erreur={champs['famille']}>
        <select
          id="opp-famille"
          value={brouillon.famille}
          onChange={(e) =>
            setBrouillon((b) => ({ ...b, famille: e.target.value as FamilleOpportuniteContrat }))
          }
          className={CLASSE_CHAMP}
        >
          {Object.entries(LIBELLE_FAMILLE).map(([valeur, libelle]) => (
            <option key={valeur} value={valeur}>
              {libelle}
            </option>
          ))}
        </select>
      </EnveloppeChamp>

      <EnveloppeChamp id="opp-type" label="Type" erreur={champs['type']}>
        <select
          id="opp-type"
          value={brouillon.type}
          onChange={(e) =>
            setBrouillon((b) => ({ ...b, type: e.target.value as TypeEvenementOpportunite }))
          }
          className={CLASSE_CHAMP}
        >
          {Object.entries(LIBELLE_TYPE).map(([valeur, libelle]) => (
            <option key={valeur} value={valeur}>
              {libelle}
            </option>
          ))}
        </select>
      </EnveloppeChamp>

      <div className="grid grid-cols-2 gap-groupe">
        <EnveloppeChamp id="opp-dateDebut" label="Début" erreur={champs['dateDebut']}>
          <input
            id="opp-dateDebut"
            type="date"
            required
            value={brouillon.dateDebut}
            onChange={(e) => setBrouillon((b) => ({ ...b, dateDebut: e.target.value }))}
            className={CLASSE_CHAMP}
          />
        </EnveloppeChamp>
        <EnveloppeChamp id="opp-dateFin" label="Fin" erreur={champs['dateFin']}>
          <input
            id="opp-dateFin"
            type="date"
            required
            value={brouillon.dateFin}
            onChange={(e) => setBrouillon((b) => ({ ...b, dateFin: e.target.value }))}
            className={CLASSE_CHAMP}
          />
        </EnveloppeChamp>
      </div>
      {brouillon.famille === 'marche_noel' && brouillon.dateDebut !== brouillon.dateFin && (
        <p className="text-xs text-ink-3">
          Une session par jour, du début à la fin inclus (hypothèse fiche 14 §3.3).
        </p>
      )}

      <EnveloppeChamp
        id="opp-communeTexte"
        label="Commune (optionnel)"
        erreur={champs['communeTexte']}
      >
        <input
          id="opp-communeTexte"
          type="text"
          value={brouillon.communeTexte}
          onChange={(e) => setBrouillon((b) => ({ ...b, communeTexte: e.target.value }))}
          className={CLASSE_CHAMP}
        />
      </EnveloppeChamp>

      <EnveloppeChamp
        id="opp-lieuId"
        label="Lieu de marché déjà déclaré (optionnel)"
        erreur={champs['lieuId']}
      >
        <select
          id="opp-lieuId"
          value={brouillon.lieuId}
          onChange={(e) => setBrouillon((b) => ({ ...b, lieuId: e.target.value }))}
          className={CLASSE_CHAMP}
        >
          <option value="">Aucun — distance à vol d’oiseau ci-dessous</option>
          {lieux.map((lieu) => (
            <option key={lieu.id} value={lieu.id}>
              {lieu.nom}
            </option>
          ))}
        </select>
      </EnveloppeChamp>

      {brouillon.lieuId === '' && (
        <EnveloppeChamp
          id="opp-distanceKm"
          label="Distance à vol d’oiseau, km (optionnel)"
          erreur={champs['distanceKm']}
        >
          <input
            id="opp-distanceKm"
            type="text"
            inputMode="decimal"
            value={brouillon.distanceKm}
            onChange={(e) => setBrouillon((b) => ({ ...b, distanceKm: e.target.value }))}
            className={CLASSE_CHAMP}
          />
        </EnveloppeChamp>
      )}

      {brouillon.famille === 'entreprise' && (
        <EnveloppeChamp
          id="opp-effectifEstime"
          label="Effectif estimé (optionnel)"
          erreur={champs['effectifEstime']}
        >
          <input
            id="opp-effectifEstime"
            type="number"
            min={0}
            step={1}
            value={brouillon.effectifEstime}
            onChange={(e) => setBrouillon((b) => ({ ...b, effectifEstime: e.target.value }))}
            className={CLASSE_CHAMP}
          />
          <p className="mt-1 text-xs text-ink-3">
            Le taux de prise n’est pas encore mesuré : la prévision restera silencieuse tant
            qu’aucune observation réelle n’existe (D-059).
          </p>
        </EnveloppeChamp>
      )}

      <EnveloppeChamp id="opp-source" label="Source (optionnel)" erreur={champs['source']}>
        <input
          id="opp-source"
          type="text"
          value={brouillon.source}
          onChange={(e) => setBrouillon((b) => ({ ...b, source: e.target.value }))}
          className={CLASSE_CHAMP}
        />
      </EnveloppeChamp>

      <EnveloppeChamp id="opp-notes" label="Notes (optionnel)" erreur={champs['notes']}>
        <textarea
          id="opp-notes"
          rows={2}
          value={brouillon.notes}
          onChange={(e) => setBrouillon((b) => ({ ...b, notes: e.target.value }))}
          className={CLASSE_CHAMP_TEXTAREA}
        />
      </EnveloppeChamp>

      {champs['_global'] !== undefined && (
        <p className="text-xs text-depassement">{champs['_global']}</p>
      )}

      {envoi.statut === 'erreur' && (
        <p role="alert" className="text-sm text-depassement">
          {envoi.message}
        </p>
      )}
      {envoi.statut === 'succes' && (
        <p role="status" className="text-sm text-conforme">
          Opportunité créée.
        </p>
      )}

      <button
        type="submit"
        disabled={envoi.statut === 'envoi'}
        className="h-controle w-full rounded-sm bg-accent text-sm text-on-accent hover:bg-accent-hover disabled:opacity-50"
      >
        {envoi.statut === 'envoi' ? 'Création…' : 'Créer l’opportunité'}
      </button>
    </form>
  );
}
