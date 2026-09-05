import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GLYPHE_STATUT,
  TIRET_ABSENT,
  champsDepuisErreurZod,
  distanceVolDoiseauKm,
  etatDistanceLieu,
  formaterEcartWatts,
  formaterMontant,
  ouTiret,
  parserEuros,
  schemaFacturationElectricite,
  schemaLieuComplet,
  schemaListeLieuxComplets,
  schemaModeTarification,
  schemaSaisieLieu,
  type ChampsEnErreur,
  type FacturationElectricite,
  type LieuComplet,
  type ModeTarification,
} from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { champsEnErreurApresModification } from '../composants/formulaire';
import { MessageErreur } from '../composants/EncartErreur';
import { ChampSelect, ChampTexte } from '../composants/champs-formulaire';
import { ErreurApi, requeteApi } from '../lib/api';
/**
 * Diagnostic de disjonction (fiche 17, D-055) : `packages/core/src/energie.ts`
 * et son contrat sont NEUFS, hors des barrels `@batte/core` (câblage réservé
 * à l'orchestrateur — voir le rapport de livraison pour les lignes exactes à
 * y ajouter). Imports relatifs temporaires, même convention que
 * `apps/web/src/pages/Concurrents.tsx` avant son câblage.
 */
import { diagnosticPuissanceLieu } from '@batte/core';
import { schemaListeEquipements } from '@batte/core';

/**
 * Écran Lieux de marché (docs/06 — parcours de premier lancement, étape 1).
 *
 * POURQUOI CET ÉCRAN EXISTE. `lieu_marche` n'était écrite que par la graine
 * (docs/13 §4.7) : « un second marché est impossible ». La Batte était donc le
 * seul lieu possible à vie, et ses coordonnées — celles que le moteur de
 * prévision passe à Open-Meteo — n'étaient pas modifiables.
 *
 * DEUX CHAMPS PORTENT DES CONSÉQUENCES QUI NE SE DEVINENT PAS, et l'écran le
 * dit plutôt que de les laisser découvrir :
 *
 * 1. **Latitude et longitude** alimentent `releverMeteo`. Sans elles, la route
 *    de prévision répond « Le lieu n'a pas de coordonnées » et le facteur météo
 *    est neutralisé — la prévision continue de fonctionner, mais amputée. Un
 *    marché couvert peut légitimement s'en passer ; il faut le savoir.
 * 2. **Le mode de tarification** décide si le tarif est multipliable. Au mètre
 *    linéaire sans métrage, le coût d'emplacement reste inconnu alors qu'il
 *    entre dans la marge de session.
 *
 * On ne supprime pas, on désactive (CLAUDE.md §3 règle 7) : des sessions
 * clôturées référencent le lieu, et ce sont des pièces comptables que le droit
 * belge impose de pouvoir relire pendant dix ans.
 *
 * Règle d'architecture n°1 : aucun calcul métier ici. Le montant passe par
 * `parserEuros` / `formaterMontant`, la validation par le schéma Zod partagé —
 * le même que rejoue le serveur.
 */

type EtatEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; lieux: LieuComplet[] };

type EtatEnregistrement =
  | { phase: 'inchange' }
  | { phase: 'modifie' }
  | { phase: 'enregistrement' }
  | {
      phase: 'enregistre';
      heure: string;
      /**
       * `distanceCalculAutomatique.raison` (`schemaLieuComplet`,
       * docs/21-CHAMPS-NON-LUS.md §2.8) : quand le calcul automatique de
       * distance (OpenRouteService) échoue à cette écriture précise, le motif
       * est calculé et renvoyé — mais jamais montré avant ce correctif, alors
       * que la distance affichée peut rester vide ou périmée sans explication.
       * `null` = calcul réussi (ou non tenté, ex. coordonnées absentes) :
       * rien à signaler.
       */
      avertissementDistance: string | null;
    };

type Brouillon = {
  nom: string;
  adresse: string;
  latitude: string;
  longitude: string;
  jourSemaine: string;
  heureDebut: string;
  heureFin: string;
  tarif: string;
  modeTarification: string;
  metresLineaires: string;
  distanceKm: string;
  facturationElectricite: string;
  puissanceDisponibleW: string;
  notes: string;
};

const BROUILLON_VIDE: Brouillon = {
  nom: '',
  adresse: '',
  latitude: '',
  longitude: '',
  jourSemaine: '',
  heureDebut: '',
  heureFin: '',
  tarif: '',
  modeTarification: '',
  metresLineaires: '',
  distanceKm: '',
  facturationElectricite: '',
  puissanceDisponibleW: '',
  notes: '',
};

/** 0 = dimanche, comme `Date.getDay()`. La Batte se tient le dimanche. */
const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'] as const;

const LIBELLES_TARIFICATION: Readonly<Record<ModeTarification, string>> = {
  metre_lineaire_mois: 'Au mètre linéaire, par mois',
  jour: 'À la journée',
  forfait: 'Forfait',
};

const LIBELLES_ELECTRICITE: Readonly<Record<FacturationElectricite, string>> = {
  compteur: 'Au compteur',
  forfait: 'Forfait journalier',
  comprise: 'Comprise dans l’emplacement',
  aucune: 'Aucune électricité disponible',
};

/**
 * Attribution obligatoire (licence CC-BY 4.0) : la distance routière d'un lieu
 * peut être calculée automatiquement par OpenRouteService à partir de données
 * OpenStreetMap (`apps/api/src/itineraire/client.ts`, `ATTRIBUTION_OPENSTREETMAP`).
 *
 * Décision du porteur : pas de colonne de provenance en base
 * (`distance_km_origine` n'existe pas — voir `referentiel-ecriture.ts`), donc
 * impossible de savoir ligne à ligne si LA valeur affichée vient du calcul
 * automatique ou d'une saisie manuelle. Une mention unique AU NIVEAU DE
 * L'ÉCRAN, montrée que la distance en cours soit calculée ou saisie à la
 * main, satisfait la licence sans avoir besoin de cette colonne.
 */
const MENTION_ATTRIBUTION_DISTANCE =
  'Distance calculée automatiquement via OpenRouteService, © contributeurs OpenStreetMap (CC BY 4.0), ou saisie manuellement.';

const CLASSE_BOUTON_PRIMAIRE =
  'h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:bg-ink-4';
const CLASSE_BOUTON_SECONDAIRE =
  'h-controle rounded-sm border border-line-field bg-surface px-3 text-sm font-medium text-ink-2 hover:bg-surface-sunken';

function heureCourante(): string {
  return new Intl.DateTimeFormat('fr-BE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Brussels',
  }).format(new Date());
}

/**
 * Lit un champ numérique. `''` vaut ABSENT ; toute autre saisie est rendue
 * telle quelle, `NaN` compris, pour que le schéma partagé produise le message
 * exact sous le bon champ plutôt qu'un silence.
 */
function nombreSaisi(saisie: string): number | null {
  const nettoye = saisie.trim().replace(',', '.');
  if (nettoye === '') return null;
  return Number(nettoye);
}

/**
 * Pré-remplit un champ numérique DÉCIMAL avec la virgule française, jamais un
 * point anglo-saxon (D-074) : `distanceKm` peut désormais porter une décimale
 * — calculée par OpenRouteService au dixième de km près
 * (`apps/api/src/itineraire/client.ts`) — là où elle était toujours un compte
 * rond avant ce correctif. Un `String(nombre)` brut afficherait « 24.8 » dans
 * un formulaire où tous les autres champs (tarif via `formaterMontant`,
 * notamment) parlent en virgules. `useGrouping: false` évite qu'un séparateur
 * de milliers ne rende la valeur illisible pour `nombreSaisi` ci-dessus, qui
 * ne remplace qu'UNE virgule et ne connaît aucun séparateur de groupe.
 */
function formaterDecimalPourSaisie(valeur: number): string {
  return new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 1, useGrouping: false }).format(
    valeur,
  );
}

function versBrouillon(lieu: LieuComplet): Brouillon {
  return {
    nom: lieu.nom,
    adresse: lieu.adresse ?? '',
    latitude: lieu.latitude === null ? '' : String(lieu.latitude),
    longitude: lieu.longitude === null ? '' : String(lieu.longitude),
    jourSemaine: lieu.jourSemaine === null ? '' : String(lieu.jourSemaine),
    heureDebut: lieu.heureDebut ?? '',
    heureFin: lieu.heureFin ?? '',
    tarif: lieu.tarifEmplacementCents === null ? '' : formaterMontant(lieu.tarifEmplacementCents),
    modeTarification: lieu.modeTarification ?? '',
    metresLineaires: lieu.metresLineaires === null ? '' : String(lieu.metresLineaires),
    distanceKm: lieu.distanceKm === null ? '' : formaterDecimalPourSaisie(lieu.distanceKm),
    facturationElectricite: lieu.facturationElectricite ?? '',
    puissanceDisponibleW:
      lieu.puissanceDisponibleW === null ? '' : String(lieu.puissanceDisponibleW),
    notes: lieu.notes ?? '',
  };
}

const COLONNES: ReadonlyArray<ColonneTableau<LieuComplet>> = [
  {
    /**
     * `repli` et non ellipse : deux marchés d'une même ville partagent leur
     * début (« Marché de Liège — Saint-Lambert », « Marché de Liège — Sainte-Marguerite »)
     * et se distinguent par la FIN, exactement ce que l'ellipse coupe. Choisir
     * la mauvaise ligne ici, c'est éditer les coordonnées du mauvais marché —
     * donc relever la météo au mauvais endroit.
     */
    cle: 'nom',
    libelle: 'Lieu',
    largeur: '30%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (l) => l.nom,
  },
  {
    // `repli` : le jour de marché est une donnée qualitative identifiante (quel
    // jour ouvrir ?) — « Dimanche » se coupait en « Dima… » (audit visuel du
    // 31/07/2026), aussi ambigu qu'un numéro de lot tronqué.
    cle: 'jour',
    libelle: 'Jour',
    largeur: '16%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (l) => ouTiret(l.jourSemaine, (j) => JOURS[j] ?? String(j)),
  },
  {
    // Colonne d'EXCEPTION, pas de décoration : sans coordonnées, le facteur
    // météo de la prévision est neutralisé — silencieusement.
    cle: 'meteo',
    libelle: 'Météo',
    largeur: '18%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (l) =>
      l.latitude === null || l.longitude === null ? (
        <span className="inline-flex items-center gap-groupe text-alerte">
          <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span>
          sans coordonnées
        </span>
      ) : (
        <span className="text-ink-2">localisé</span>
      ),
  },
  {
    cle: 'sessions',
    libelle: 'Sessions',
    largeur: '16%',
    alignement: 'nombre',
    rendu: (l) => String(l.nbSessions),
  },
  {
    cle: 'statut',
    libelle: 'Statut',
    largeur: '20%',
    alignement: 'texte',
    // Vocabulaire de statut UNIFIÉ (recette au navigateur du 31/07/2026) :
    // « Actif » se rendait en `text-ink-2`, la couleur de texte par défaut —
    // ni glyphe ni couleur de signal, contrairement à Sessions/Fournisseurs
    // (`statutFournisseur`, `Fournisseurs.tsx`). « Retiré » reste NEUTRE (fin
    // de service normale, pas une alerte), même traitement que « Inactif ».
    rendu: (l) =>
      l.actif ? (
        <span className="text-conforme">{GLYPHE_STATUT.conforme} Actif</span>
      ) : (
        <span className="text-ink-3">Retiré</span>
      ),
  },
];

export default function LieuxMarche() {
  const [etat, setEtat] = useState<EtatEcran>({ statut: 'chargement' });
  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [brouillon, setBrouillon] = useState<Brouillon>(BROUILLON_VIDE);
  const [champsEnErreur, setChampsEnErreur] = useState<ChampsEnErreur>({});
  const [erreurFormulaire, setErreurFormulaire] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState<EtatEnregistrement>({ phase: 'inchange' });
  const [afficherRetires, setAfficherRetires] = useState(false);
  /**
   * Puissance du parc d'équipements EN SERVICE (fiche 17) — `null` tant
   * qu'elle n'a pas pu être lue, jamais 0 par défaut (D-055 : une inconnue ne
   * se devine pas). Chargée une fois : c'est la même valeur pour tous les
   * lieux, les équipements voyageant avec le stand.
   */
  const [puissanceTotaleEnServiceW, setPuissanceTotaleEnServiceW] = useState<number | null>(null);

  /**
   * Coordonnées de DÉPART pour la suggestion de distance à vol d'oiseau
   * (docs/demandes/13 §5.2, option double n°2). ÉPHÉMÈRE et jamais
   * enregistré nulle part — ce n'est PAS un domicile persistant : la fiche
   * 13 §5.1 laisse ouvert le choix entre point de départ unique ou par
   * session, et ce n'est pas à cet écran de le trancher. Volontairement PAS
   * réinitialisé par `choisir()`/`nouveau()` : le même point de départ sert
   * en général à plusieurs lieux d'affilée.
   */
  const [origineLatitude, setOrigineLatitude] = useState('');
  const [origineLongitude, setOrigineLongitude] = useState('');

  const formulaireRef = useRef<HTMLFormElement>(null);

  const charger = useCallback(async (): Promise<LieuComplet[]> => {
    const reponse = await requeteApi<unknown>('/referentiel/lieux');
    return schemaListeLieuxComplets.parse(reponse).data;
  }, []);

  useEffect(() => {
    let annule = false;

    charger()
      .then((lieux) => {
        if (annule) return;
        setEtat({ statut: 'pret', lieux });
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

  useEffect(() => {
    let annule = false;

    requeteApi<unknown>('/equipements')
      .then((reponse) => {
        if (annule) return;
        setPuissanceTotaleEnServiceW(
          schemaListeEquipements.parse(reponse).meta.puissanceTotaleEnServiceW,
        );
      })
      .catch(() => {
        // Dégradé volontaire (CLAUDE.md §5) : le diagnostic de disjonction est
        // un complément à cet écran, pas sa raison d'être. Sans lui, la
        // gestion des lieux reste pleinement utilisable — il disparaît
        // simplement, plutôt que de casser l'écran entier.
        if (!annule) setPuissanceTotaleEnServiceW(null);
      });

    return () => {
      annule = true;
    };
  }, []);

  const lieux = useMemo(() => (etat.statut === 'pret' ? etat.lieux : []), [etat]);

  const visibles = useMemo(
    () => lieux.filter((l) => afficherRetires || l.actif),
    [lieux, afficherRetires],
  );

  const selection = useMemo(
    () => lieux.find((l) => l.id === selectionId) ?? null,
    [lieux, selectionId],
  );

  /**
   * Diagnostic de disjonction EN DIRECT, sur la valeur SAISIE (pas encore
   * enregistrée) de puissance disponible : « 4 500 W prévus pour 3 500 W
   * disponibles » se voit avant même d'enregistrer le lieu (fiche 17).
   * `null` tant que la puissance du parc n'a pas pu être lue — jamais
   * interprété comme « pas de risque ».
   */
  const diagnosticPuissanceActuel = useMemo(
    () =>
      puissanceTotaleEnServiceW === null
        ? null
        : diagnosticPuissanceLieu(
            puissanceTotaleEnServiceW,
            nombreSaisi(brouillon.puissanceDisponibleW),
          ),
    [puissanceTotaleEnServiceW, brouillon.puissanceDisponibleW],
  );

  function choisir(lieu: LieuComplet): void {
    setSelectionId(lieu.id);
    setBrouillon(versBrouillon(lieu));
    setChampsEnErreur({});
    setErreurFormulaire(null);
    setEnregistrement({ phase: 'inchange' });
  }

  function nouveau(): void {
    setSelectionId(null);
    setBrouillon(BROUILLON_VIDE);
    setChampsEnErreur({});
    setErreurFormulaire(null);
    setEnregistrement({ phase: 'inchange' });
    window.setTimeout(() => formulaireRef.current?.querySelector('input')?.focus(), 0);
  }

  function modifier<C extends keyof Brouillon>(champ: C, valeur: Brouillon[C]): void {
    setBrouillon((precedent) => ({ ...precedent, [champ]: valeur }));
    setEnregistrement({ phase: 'modifie' });
    // Validation À LA SAUVEGARDE, jamais en direct — voir
    // `champsEnErreurApresModification` (`../composants/formulaire`) pour la
    // justification complète et partagée avec Ingrédients et Produits.
    setChampsEnErreur(champsEnErreurApresModification);
  }

  function focaliserPremierChampFautif(champs: ChampsEnErreur): void {
    const premier = Object.keys(champs)[0];
    if (premier === undefined) return;
    formulaireRef.current?.querySelector<HTMLElement>(`[name="${premier}"]`)?.focus();
  }

  function enregistrer(): void {
    let tarifCents: number | null = null;
    if (brouillon.tarif.trim() !== '') {
      tarifCents = parserEuros(brouillon.tarif);
      if (tarifCents === null) {
        const cibles = { tarifEmplacementCents: 'Tarif illisible. Exemple attendu : 22,00' };
        setChampsEnErreur(cibles);
        focaliserPremierChampFautif(cibles);
        return;
      }
    }

    const corps = {
      nom: brouillon.nom,
      adresse: brouillon.adresse,
      latitude: nombreSaisi(brouillon.latitude),
      longitude: nombreSaisi(brouillon.longitude),
      jourSemaine: nombreSaisi(brouillon.jourSemaine),
      heureDebut: brouillon.heureDebut,
      heureFin: brouillon.heureFin,
      tarifEmplacementCents: tarifCents,
      modeTarification: brouillon.modeTarification === '' ? null : brouillon.modeTarification,
      metresLineaires: nombreSaisi(brouillon.metresLineaires),
      distanceKm: nombreSaisi(brouillon.distanceKm),
      facturationElectricite:
        brouillon.facturationElectricite === '' ? null : brouillon.facturationElectricite,
      puissanceDisponibleW: nombreSaisi(brouillon.puissanceDisponibleW),
      notes: brouillon.notes,
    };

    // Le MÊME schéma que le serveur, rejoué avant tout aller-retour : la règle
    // « une coordonnée seule ne localise rien » s'affiche sous le champ manquant
    // sans attendre la réponse.
    const verification = schemaSaisieLieu.safeParse(corps);
    if (!verification.success) {
      const champs = champsDepuisErreurZod(verification.error);
      setChampsEnErreur(champs);
      focaliserPremierChampFautif(champs);
      setEnregistrement({ phase: 'modifie' });
      return;
    }

    setErreurFormulaire(null);
    setEnregistrement({ phase: 'enregistrement' });

    const chemin = selectionId === null ? '/lieux' : `/lieux/${selectionId}`;
    const methode = selectionId === null ? 'POST' : 'PATCH';

    requeteApi<unknown>(chemin, { method: methode, body: JSON.stringify(corps) })
      .then(async (reponse) => {
        const enregistre = schemaLieuComplet.parse(reponse);
        const liste = await charger();
        setEtat({ statut: 'pret', lieux: liste });
        setSelectionId(enregistre.id);
        setBrouillon(versBrouillon(enregistre));
        setChampsEnErreur({});
        setEnregistrement({
          phase: 'enregistre',
          heure: heureCourante(),
          avertissementDistance:
            enregistre.distanceCalculAutomatique !== null &&
            !enregistre.distanceCalculAutomatique.reussi
              ? enregistre.distanceCalculAutomatique.raison
              : null,
        });
      })
      .catch((erreur: unknown) => {
        setEnregistrement({ phase: 'modifie' });
        if (erreur instanceof ErreurApi && erreur.champs !== undefined) {
          setChampsEnErreur(erreur.champs);
          focaliserPremierChampFautif(erreur.champs);
          return;
        }
        setErreurFormulaire(
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
        );
      });
  }

  function basculerActivite(): void {
    if (selection === null) return;

    requeteApi<unknown>(`/lieux/${selection.id}/activite`, {
      method: 'PATCH',
      body: JSON.stringify({ actif: !selection.actif }),
    })
      .then(async (reponse) => {
        const modifie = schemaLieuComplet.parse(reponse);
        const liste = await charger();
        setEtat({ statut: 'pret', lieux: liste });
        setBrouillon(versBrouillon(modifie));
        // Bascule d'activité seule : aucune coordonnée ne change, le calcul
        // automatique de distance n'est jamais retenté ici.
        setEnregistrement({
          phase: 'enregistre',
          heure: heureCourante(),
          avertissementDistance: null,
        });
      })
      .catch((erreur: unknown) => {
        setErreurFormulaire(
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
        );
      });
  }

  return (
    <div
      className="flex flex-col gap-bloc"
      onKeyDown={(evenement) => {
        if ((evenement.ctrlKey || evenement.metaKey) && evenement.key === 's') {
          evenement.preventDefault();
          enregistrer();
        }
      }}
    >
      <div className="flex h-rangee items-center justify-between">
        <h1 className="text-lg text-ink">Lieux de marché</h1>
        <button type="button" onClick={nouveau} className={CLASSE_BOUTON_PRIMAIRE}>
          Nouveau lieu
        </button>
      </div>

      {/* Point de rupture à `lg` (1024 px) et jamais à `xl` (1280 px) : la cible
          de conception est un viewport EFFECTIF de 1280x720. */}
      <div className="grid grid-cols-1 items-start gap-bloc lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        {/* ═══ Liste ══════════════════════════════════════════════════════ */}
        <Panneau titre="Lieux de marché" sansRembourrage>
          <div className="border-b border-line px-4 py-2">
            <label className="flex items-center gap-groupe text-sm text-ink-2">
              <input
                type="checkbox"
                checked={afficherRetires}
                onChange={(evenement) => setAfficherRetires(evenement.target.checked)}
              />
              Afficher aussi les lieux retirés
            </label>
          </div>

          {etat.statut === 'chargement' && (
            <p className="px-4 py-2 text-sm text-ink-3">Chargement des lieux…</p>
          )}

          {etat.statut === 'erreur' && (
            <div className="px-4 py-2">
              <MessageErreur message={etat.message} />
            </div>
          )}

          {etat.statut === 'pret' && (
            <Tableau
              colonnes={COLONNES}
              lignes={visibles}
              cleLigne={(l) => l.id}
              total={lieux.length}
              libelleEntite="lieux"
              {...(selectionId !== null ? { ligneSelectionneeCle: selectionId } : {})}
              onSelectionnerLigne={choisir}
              etatVide={
                lieux.length > 0 ? (
                  <EtatVide
                    variante="filtre"
                    explicationFiltre={
                      lieux.length > 1
                        ? `Les ${lieux.length} lieux enregistrés sont tous retirés, et le filtre les masque.`
                        : "L'unique lieu enregistré est retiré, et le filtre le masque."
                    }
                    onReinitialiser={() => setAfficherRetires(true)}
                  />
                ) : (
                  <EtatVide
                    variante="premier-lancement"
                    titre="Aucun lieu de marché"
                    explication="Créez le marché où vous vous installez. Ses coordonnées servent à relever la météo, sa fenêtre horaire à borner la capacité de cuisson."
                    action={{ libelle: 'Créer un lieu', onClick: nouveau }}
                  />
                )
              }
            />
          )}
        </Panneau>

        {/* ═══ Fiche ══════════════════════════════════════════════════════ */}
        <Panneau titre={selection === null ? 'Nouveau lieu' : selection.nom}>
          <form
            ref={formulaireRef}
            className="flex flex-col gap-bloc"
            onSubmit={(evenement) => {
              evenement.preventDefault();
              enregistrer();
            }}
          >
            <ChampTexte
              nom="nom"
              libelle="Nom du lieu"
              valeur={brouillon.nom}
              onChange={(v) => modifier('nom', v)}
              erreur={champsEnErreur['nom']}
              obligatoire
            />

            <ChampTexte
              nom="adresse"
              libelle="Adresse"
              valeur={brouillon.adresse}
              onChange={(v) => modifier('adresse', v)}
              erreur={champsEnErreur['adresse']}
            />

            <div className="grid grid-cols-2 gap-groupe">
              <ChampTexte
                nom="latitude"
                libelle="Latitude"
                valeur={brouillon.latitude}
                onChange={(v) => modifier('latitude', v)}
                erreur={champsEnErreur['latitude']}
                numerique="decimal"
              />
              <ChampTexte
                nom="longitude"
                libelle="Longitude"
                valeur={brouillon.longitude}
                onChange={(v) => modifier('longitude', v)}
                erreur={champsEnErreur['longitude']}
                numerique="decimal"
              />
            </div>
            <p className="text-xs text-ink-3">
              Les coordonnées servent au relevé météo, qui alimente la prévision de production. Sans
              elles, la prévision fonctionne mais son facteur météo est neutralisé — un marché
              couvert peut légitimement s’en passer. Renseignez les deux, ou aucune.
            </p>

            <div className="grid grid-cols-3 gap-groupe">
              <ChampSelect
                nom="jourSemaine"
                libelle="Jour"
                valeur={brouillon.jourSemaine}
                onChange={(v) => modifier('jourSemaine', v)}
                erreur={champsEnErreur['jourSemaine']}
                options={JOURS.map((libelle, index) => ({ valeur: String(index), libelle }))}
                optionVide="—"
              />
              <ChampTexte
                nom="heureDebut"
                libelle="Début"
                type="time"
                valeur={brouillon.heureDebut}
                onChange={(v) => modifier('heureDebut', v)}
                erreur={champsEnErreur['heureDebut']}
              />
              <ChampTexte
                nom="heureFin"
                libelle="Fin"
                type="time"
                valeur={brouillon.heureFin}
                onChange={(v) => modifier('heureFin', v)}
                erreur={champsEnErreur['heureFin']}
              />
            </div>

            <div className="grid grid-cols-2 gap-groupe">
              <ChampTexte
                nom="tarifEmplacementCents"
                libelle="Tarif d’emplacement (€)"
                valeur={brouillon.tarif}
                onChange={(v) => modifier('tarif', v)}
                erreur={champsEnErreur['tarifEmplacementCents']}
                numerique="decimal"
              />
              <ChampSelect
                nom="modeTarification"
                libelle="Mode de tarification"
                valeur={brouillon.modeTarification}
                onChange={(v) => modifier('modeTarification', v)}
                erreur={champsEnErreur['modeTarification']}
                options={schemaModeTarification.options.map((mode) => ({
                  valeur: mode,
                  libelle: LIBELLES_TARIFICATION[mode],
                }))}
                optionVide="—"
              />
            </div>

            {/* Le métrage n'apparaît que là où il sert : sans lui, un tarif au
                mètre linéaire n'est pas multipliable, donc le coût d'emplacement
                reste inconnu alors qu'il entre dans la marge de session. */}
            {brouillon.modeTarification === 'metre_lineaire_mois' && (
              <ChampTexte
                nom="metresLineaires"
                libelle="Mètres linéaires occupés"
                valeur={brouillon.metresLineaires}
                onChange={(v) => modifier('metresLineaires', v)}
                erreur={champsEnErreur['metresLineaires']}
                numerique="entier"
                aide="Le tarif au mètre linéaire se multiplie par ce métrage : sans lui, le coût d’emplacement de la session ne peut pas être établi."
              />
            )}

            <ChampTexte
              nom="distanceKm"
              libelle="Distance depuis le point de départ (km, aller simple)"
              valeur={brouillon.distanceKm}
              onChange={(v) => modifier('distanceKm', v)}
              erreur={champsEnErreur['distanceKm']}
              numerique="decimal"
              aide="Distance ROUTIÈRE, lue sur un GPS — pas à vol d’oiseau, qui se trompe couramment de 20 à 40 %. Sans elle, ce lieu ne peut pas être comparé aux autres sur la marge nette attendue."
            />
            <p className="text-xs text-ink-3">{MENTION_ATTRIBUTION_DISTANCE}</p>

            <PanneauSuggestionDistance
              distanceConfirmeeKm={nombreSaisi(brouillon.distanceKm)}
              latitudeLieu={nombreSaisi(brouillon.latitude)}
              longitudeLieu={nombreSaisi(brouillon.longitude)}
              origineLatitude={origineLatitude}
              origineLongitude={origineLongitude}
              onChangerOrigineLatitude={setOrigineLatitude}
              onChangerOrigineLongitude={setOrigineLongitude}
              onUtiliser={(km) => modifier('distanceKm', String(km))}
            />

            <div className="grid grid-cols-2 gap-groupe">
              <ChampSelect
                nom="facturationElectricite"
                libelle="Électricité sur l’emplacement"
                valeur={brouillon.facturationElectricite}
                onChange={(v) => modifier('facturationElectricite', v)}
                erreur={champsEnErreur['facturationElectricite']}
                options={schemaFacturationElectricite.options.map((mode) => ({
                  valeur: mode,
                  libelle: LIBELLES_ELECTRICITE[mode],
                }))}
                optionVide="—"
              />
              <ChampTexte
                nom="puissanceDisponibleW"
                libelle="Puissance disponible (W)"
                valeur={brouillon.puissanceDisponibleW}
                onChange={(v) => modifier('puissanceDisponibleW', v)}
                erreur={champsEnErreur['puissanceDisponibleW']}
                numerique="entier"
              />
            </div>

            {/* Diagnostic de disjonction (fiche 17, D-055) : la PUISSANCE (ce
                qui passe dans le câble à l'instant) n'est pas l'ÉNERGIE (ce
                qu'on paie). Rien n'est recalculé ici — `diagnosticPuissanceLieu`
                vient de `@batte/core`, ce composant ne fait qu'afficher.

                Statut aligné sur `Equipements.tsx` (revu le 31/07/2026) :
                `risqueDisjonction === null` veut dire « puissance disponible
                non renseignée, on ne sait pas si le compteur tiendra » —
                jamais une alerte, une inconnue n'est pas un jugement
                (CLAUDE.md §7). C'était l'écart avec `Equipements.tsx`, qui
                traitait déjà ce cas en neutre. `risqueDisjonction === false`
                est un FAIT calculé (« ça tient »), pas un silence : il porte
                `text-conforme`, comme partout ailleurs où un `Statut`
                s'affiche (`PastilleStatut`, `LigneSeuil`…) — le laisser sans
                couleur le rendrait indiscernable de l'inconnu ci-dessus,
                alors que ce sont deux informations différentes. */}
            {diagnosticPuissanceActuel !== null &&
              diagnosticPuissanceActuel.puissanceRequiseW > 0 && (
                <p
                  className={`text-xs ${
                    diagnosticPuissanceActuel.risqueDisjonction === true
                      ? 'text-depassement'
                      : diagnosticPuissanceActuel.risqueDisjonction === false
                        ? 'text-conforme'
                        : 'text-ink-3'
                  }`}
                >
                  {diagnosticPuissanceActuel.avertissement ??
                    // `margeW` (docs/21-CHAMPS-NON-LUS.md §2.1) : la marge REELLE,
                    // positive ici puisque `avertissement` est `null`, n'etait
                    // jamais dite — seul le risque en booleen l'etait.
                    `${diagnosticPuissanceActuel.puissanceRequiseW} W d’équipements en service ` +
                      `sur ce lieu : ${
                        diagnosticPuissanceActuel.margeW !== null
                          ? `marge de ${formaterEcartWatts(diagnosticPuissanceActuel.margeW)} avant disjonction`
                          : 'aucun risque de disjonction connu'
                      }.`}
                </p>
              )}

            <ChampTexte
              nom="notes"
              libelle="Notes"
              valeur={brouillon.notes}
              onChange={(v) => modifier('notes', v)}
              erreur={champsEnErreur['notes']}
            />

            {erreurFormulaire !== null && <MessageErreur message={erreurFormulaire} />}

            <div className="flex items-center justify-between border-t border-line pt-3">
              <IndicateurEnregistrement etat={enregistrement} />
              <div className="flex items-center gap-groupe">
                {selection !== null && (
                  <button
                    type="button"
                    onClick={basculerActivite}
                    className={CLASSE_BOUTON_SECONDAIRE}
                  >
                    {selection.actif ? 'Retirer de la liste' : 'Remettre en service'}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={enregistrement.phase === 'enregistrement'}
                  className={CLASSE_BOUTON_PRIMAIRE}
                >
                  Enregistrer
                </button>
              </div>
            </div>

            {selection !== null && (
              <p className="text-xs text-ink-3">
                Un lieu ne se supprime pas : {selection.nbSessions} session(s) le référencent, et
                une session clôturée est une pièce comptable. Retiré, il disparaît des listes de
                choix mais reste dans l’historique.
              </p>
            )}
          </form>
        </Panneau>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Sous-composants locaux

   `ChampTexte`, `ChampSelect` et `ChampHeure` (`type="time"` sur `ChampTexte`
   partagé, rendu identique) viennent désormais de `../composants/champs-
   formulaire` (01/08/2026). `IndicateurEnregistrement` et son `EtatEnregistrement`
   RESTENT ICI, volontairement : contrairement aux cinq autres écrans, cet
   écran porte une variante `enregistre` à TROIS champs
   (`avertissementDistance`, en plus de `heure`) — voir juste en dessous. La
   version partagée n'a que `heure` ; l'écraser aurait fait disparaître
   l'avertissement de calcul automatique de distance en échec (docs/21-
   CHAMPS-NON-LUS.md §2.8) sans qu'aucun test ne le signale avant longtemps.
   ═══════════════════════════════════════════════════════════════════════════ */

function IndicateurEnregistrement({ etat }: { etat: EtatEnregistrement }) {
  switch (etat.phase) {
    case 'inchange':
      return <span className="text-xs text-ink-3">{TIRET_ABSENT}</span>;
    case 'modifie':
      return <span className="text-xs text-alerte">Modifications non enregistrées</span>;
    case 'enregistrement':
      return <span className="text-xs text-ink-3">Enregistrement…</span>;
    case 'enregistre':
      return (
        <span className="flex flex-col items-end gap-1">
          <span className="text-xs text-conforme">Enregistré {etat.heure}</span>
          {/* `avertissementDistance` (docs/21-CHAMPS-NON-LUS.md §2.8) : le
              calcul automatique de distance a échoué à CETTE écriture — sans
              cette ligne, la distance restait vide ou périmée sans un mot
              d'explication. */}
          {etat.avertissementDistance !== null && (
            <span className="text-2xs text-alerte">{etat.avertissementDistance}</span>
          )}
        </span>
      );
  }
}

type PanneauSuggestionDistanceProps = {
  distanceConfirmeeKm: number | null;
  latitudeLieu: number | null;
  longitudeLieu: number | null;
  origineLatitude: string;
  origineLongitude: string;
  onChangerOrigineLatitude: (valeur: string) => void;
  onChangerOrigineLongitude: (valeur: string) => void;
  onUtiliser: (km: number) => void;
};

/**
 * Suggestion de distance à VOL D'OISEAU (docs/demandes/13 §5.2, option double
 * n°2 : la distance saisie ET calculée). `distance_km` reste seul décisif
 * (D-060, `coutDeplacementSessionCents`) — cette suggestion PRÉ-REMPLIT,
 * elle ne fait JAMAIS foi. Elle n'est écrite en base que si l'utilisateur
 * clique « Utiliser cette estimation » PUIS enregistre le formulaire.
 *
 * Le point de départ n'est PAS un domicile persistant : la fiche 13 §5.1
 * laisse ce choix ouvert au porteur (unique ou par session), et ce n'est pas
 * à ce lot de le trancher. L'utilisateur tape donc ses coordonnées de départ
 * ICI, à la volée — rien n'est enregistré nulle part, ce composant ne fait
 * QUE du calcul, sur le même principe que le diagnostic de disjonction
 * ci-dessus (`diagnosticPuissanceLieu`).
 */
function PanneauSuggestionDistance({
  distanceConfirmeeKm,
  latitudeLieu,
  longitudeLieu,
  origineLatitude,
  origineLongitude,
  onChangerOrigineLatitude,
  onChangerOrigineLongitude,
  onUtiliser,
}: PanneauSuggestionDistanceProps) {
  const latitudeOrigineValeur = nombreSaisi(origineLatitude);
  const longitudeOrigineValeur = nombreSaisi(origineLongitude);

  const suggestionKm = useMemo(() => {
    if (
      latitudeLieu === null ||
      longitudeLieu === null ||
      !Number.isFinite(latitudeLieu) ||
      !Number.isFinite(longitudeLieu) ||
      latitudeOrigineValeur === null ||
      longitudeOrigineValeur === null ||
      !Number.isFinite(latitudeOrigineValeur) ||
      !Number.isFinite(longitudeOrigineValeur)
    ) {
      return null;
    }
    return distanceVolDoiseauKm(
      { latitude: latitudeOrigineValeur, longitude: longitudeOrigineValeur },
      { latitude: latitudeLieu, longitude: longitudeLieu },
    );
  }, [latitudeLieu, longitudeLieu, latitudeOrigineValeur, longitudeOrigineValeur]);

  // Nomme l'état, ne calcule rien de plus : voir `etatDistanceLieu` (@batte/core).
  const etat = etatDistanceLieu({
    distanceKmConfirmee: distanceConfirmeeKm,
    distanceSuggereeKm: suggestionKm,
  });

  if (latitudeLieu === null || longitudeLieu === null) {
    return (
      <p className="text-xs text-ink-3">
        Ce lieu n’a pas de coordonnées : renseignez latitude et longitude ci-dessus pour activer une
        suggestion de distance à vol d’oiseau.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-groupe rounded-sm border border-line-field bg-surface-sunken p-3">
      <p className="text-xs text-ink-3">
        Suggestion à vol d’oiseau — ce N’EST PAS une distance routière (écart courant 20 à 40 %).
        Indiquez vos coordonnées de départ pour la calculer ; elle ne remplace jamais la distance
        confirmée ci-dessus tant que vous ne l’utilisez pas explicitement.
      </p>
      <div className="grid grid-cols-2 gap-groupe">
        <ChampTexte
          nom="origineLatitude"
          libelle="Latitude de départ (non enregistrée)"
          valeur={origineLatitude}
          onChange={onChangerOrigineLatitude}
          numerique="decimal"
        />
        <ChampTexte
          nom="origineLongitude"
          libelle="Longitude de départ (non enregistrée)"
          valeur={origineLongitude}
          onChange={onChangerOrigineLongitude}
          numerique="decimal"
        />
      </div>
      {etat === 'suggeree' && suggestionKm !== null && (
        <div className="flex items-center justify-between gap-groupe">
          <span className="text-xs text-alerte">
            ≈ {Math.round(suggestionKm)} km à vol d’oiseau — à corriger avec votre GPS avant de
            valider.
          </span>
          <button
            type="button"
            onClick={() => onUtiliser(Math.round(suggestionKm))}
            className={CLASSE_BOUTON_SECONDAIRE}
          >
            Utiliser cette estimation
          </button>
        </div>
      )}
      {etat === 'confirmee' && (
        <span className="text-xs text-ink-3">
          Une distance confirmée existe déjà pour ce lieu ({distanceConfirmeeKm} km) : elle prime
          toujours sur toute suggestion.
        </span>
      )}
    </div>
  );
}
