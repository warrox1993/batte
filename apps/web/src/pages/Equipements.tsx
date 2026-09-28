import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  champsDepuisErreurZod,
  formaterEcartWatts,
  formaterMontant,
  GLYPHE_STATUT,
  LIBELLE_CATEGORIE_INGREDIENT,
  ouTiret,
  TIRET_ABSENT,
  type ChampsEnErreur,
} from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { champsEnErreurApresModification } from '../composants/formulaire';
import { MessageErreur } from '../composants/EncartErreur';
import {
  ChampSelect,
  ChampTexte,
  IndicateurEnregistrement,
  type EtatEnregistrement,
} from '../composants/champs-formulaire';
import { ErreurApi, requeteApi } from '../lib/api';
import {
  schemaEmpreinteQuantitesPhysiques,
  schemaEquipement,
  schemaListeDiagnosticsPuissance,
  schemaListeEquipements,
  schemaListePointsEquilibreAutoproduction,
  schemaSaisieEquipement,
  schemaTypeEquipement,
  type DiagnosticPuissanceLieuContrat,
  type EmpreinteQuantitesPhysiquesContrat,
  type Equipement,
  type ListePointsEquilibreAutoproduction,
  type PointEquilibreAutoproductionLigne,
  type QuantitePhysiqueIngredientContrat,
  type TypeEquipement,
} from '@batte/core';

/**
 * Écran Équipements électriques du stand (docs/demandes/17-ENERGIE-GAZ-
 * ELECTRICITE-SOLAIRE-EMPREINTE.md, D-055).
 *
 * POURQUOI CET ÉCRAN EXISTE. Le chauffage sera obligatoirement électrique
 * (décision du porteur), et « il peut y avoir plusieurs sortes de radiateurs
 * qui tournent en même temps ». Un seul concept — un appareil, une puissance
 * déclarée, une durée d'usage — couvre radiateurs, éclairage, terminal de
 * paiement, froid actif et plaques électriques là où le lieu le permet : ce
 * n'est donc pas « le radiateur » qui se paramètre ici, mais l'ÉQUIPEMENT.
 *
 * LE POINT CENTRAL DE CET ÉCRAN : le diagnostic de disjonction. La PUISSANCE
 * (ce qui passe dans le câble à l'instant) n'est pas la même chose que
 * l'ÉNERGIE (ce qu'on paie dans le temps). Trois radiateurs de 1 500 W
 * allumés ensemble demandent 4 500 W simultanés, or une prise de marché
 * fournit souvent 16 A (~3 500 W) — au-delà, ça disjoncte, le matin, quand
 * tout démarre en même temps un dimanche de décembre. Le panneau du bas
 * compare donc la puissance du parc EN SERVICE à la puissance disponible de
 * CHAQUE lieu actif, sans rien inventer : c'est une somme et une comparaison,
 * pas une prévision.
 *
 * `puissanceDisponibleW` inconnue sur un lieu ne veut JAMAIS dire « pas de
 * risque » (D-055 : aucune valeur par défaut optimiste) — le panneau le dit
 * explicitement plutôt que de laisser croire à un « OK » qui n'a rien vérifié.
 *
 * On ne supprime pas un équipement, on le retire (CLAUDE.md §3 règle 7) : un
 * appareil retiré a pu chauffer des sessions déjà closes, dont le coût est une
 * pièce comptable.
 *
 * Règle d'architecture n°1 : aucun calcul métier ici. Le diagnostic vient tel
 * quel de `GET /api/equipements/diagnostic-puissance`
 * (`packages/core/src/energie.ts` côté serveur).
 *
 * DEUX PANNEAUX SUPPLÉMENTAIRES (docs/demandes/17 §3, §4), toujours en lecture
 * seule :
 *  - « Point d'équilibre solaire / éolien » — au bout de combien de sessions
 *    une installation (immobilisation existante) est-elle remboursée par
 *    l'électricité qu'on ne paie plus ? Le garde-fou de la fiche est affiché
 *    tel quel (`meta.avertissement`) : ce calcul ne compte JAMAIS le gaz de
 *    cuisson ni le chauffage, seulement l'éclairage, le froid actif et le
 *    terminal de paiement.
 *  - « Empreinte — quantités physiques » — un tableau de quantités PHYSIQUES
 *    (kilos, litres, kWh, pièces, kilomètres), AUCUNE conversion en CO2 :
 *    `meta.avertissementConversionCarbone` le rappelle, toujours affiché. Les
 *    facteurs d'émission sont des données réglementaires externes non
 *    sourcées ici (CLAUDE.md §7) — afficher un chiffre de CO2 inventé serait
 *    pire que ne rien afficher.
 */

type EtatEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; equipements: Equipement[]; puissanceTotaleEnServiceW: number };

type EtatDiagnostic =
  | { statut: 'chargement' }
  | { statut: 'erreur' }
  | {
      statut: 'pret';
      lignes: DiagnosticPuissanceLieuContrat[];
      /**
       * Agrégat du parc entier (`meta.nbEquipementsEnService`,
       * `schemaListeDiagnosticsPuissance`) : combien d'équipements composent
       * la puissance requise ci-dessus. `chargerDiagnostic` ne gardait avant
       * que `.data`, jetant ce `.meta` après le `.parse()` — le compte
       * disparaissait en silence (docs/21-CHAMPS-NON-LUS.md §2.2).
       * `meta.puissanceRequiseW`, lui, n'a pas besoin d'être repris ici :
       * c'est exactement `puissanceTotaleEnServiceW` (même fonction,
       * `sommePuissanceEnServiceW`, `apps/api/src/routes/equipements.ts`),
       * déjà affiché juste en dessous.
       */
      nbEquipementsEnService: number;
    };

type EtatPointEquilibre =
  | { statut: 'chargement' }
  | { statut: 'erreur' }
  | { statut: 'pret'; reponse: ListePointsEquilibreAutoproduction };

type EtatEmpreinte =
  | { statut: 'chargement' }
  | { statut: 'erreur' }
  | { statut: 'pret'; reponse: EmpreinteQuantitesPhysiquesContrat };

type Brouillon = {
  nom: string;
  type: string;
  puissanceW: string;
  enService: boolean;
  notes: string;
};

const BROUILLON_VIDE: Brouillon = {
  nom: '',
  type: '',
  puissanceW: '',
  enService: true,
  notes: '',
};

const LIBELLES_TYPE: Readonly<Record<TypeEquipement, string>> = {
  chauffage: 'Chauffage',
  eclairage: 'Éclairage',
  froid: 'Froid actif',
  cuisson: 'Cuisson',
  paiement: 'Terminal de paiement',
  autre: 'Autre',
};

const LIBELLES_UNITE: Readonly<
  Record<QuantitePhysiqueIngredientContrat['uniteReference'], string>
> = {
  g: 'g',
  ml: 'ml',
  piece: 'pièce(s)',
};

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

/** `''` vaut ABSENT ; toute autre saisie est rendue telle quelle, `NaN` compris. */
function nombreSaisi(saisie: string): number | null {
  const nettoye = saisie.trim().replace(',', '.');
  if (nettoye === '') return null;
  return Number(nettoye);
}

function versBrouillon(equipement: Equipement): Brouillon {
  return {
    nom: equipement.nom,
    type: equipement.type,
    puissanceW: String(equipement.puissanceW),
    enService: equipement.enService,
    notes: equipement.notes ?? '',
  };
}

const COLONNES: ReadonlyArray<ColonneTableau<Equipement>> = [
  {
    cle: 'nom',
    libelle: 'Équipement',
    largeur: '28%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (e) => e.nom,
  },
  {
    cle: 'type',
    libelle: 'Type',
    largeur: '18%',
    alignement: 'texte',
    // `repli` : « Terminal de paiement » (21 caractères) se coupait en
    // « Terminal d… » — vérifié à l'écran le 31/07/2026 avec un équipement
    // réel de ce type.
    troncature: 'repli',
    rendu: (e) => LIBELLES_TYPE[e.type],
  },
  {
    cle: 'puissance',
    libelle: 'Puissance',
    largeur: '16%',
    alignement: 'nombre',
    rendu: (e) => `${e.puissanceW} W`,
  },
  {
    cle: 'service',
    libelle: 'En service',
    largeur: '20%',
    alignement: 'texte',
    // `repli` : la valeur négative n'est pas juste « Non », mais l'explication
    // « Non — comparaison » — une phrase, pas un mot, qui ne doit pas se
    // couper en silence.
    troncature: 'repli',
    rendu: (e) =>
      e.enService ? (
        <span className="text-ink-2">Oui</span>
      ) : (
        <span className="text-ink-3">Non — comparaison</span>
      ),
  },
  {
    cle: 'statut',
    libelle: 'Statut',
    largeur: '18%',
    alignement: 'texte',
    rendu: (e) =>
      e.actif ? (
        <span className="text-ink-2">Actif</span>
      ) : (
        <span className="text-ink-3">Retiré</span>
      ),
  },
];

const COLONNES_POINT_EQUILIBRE: ReadonlyArray<ColonneTableau<PointEquilibreAutoproductionLigne>> = [
  {
    cle: 'libelle',
    libelle: 'Immobilisation',
    largeur: '40%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (l) => l.libelle,
  },
  {
    cle: 'coutInstallationCents',
    libelle: "Coût d'installation",
    largeur: '25%',
    alignement: 'nombre',
    rendu: (l) => formaterMontant(l.coutInstallationCents),
  },
  {
    cle: 'sessionsAvantEquilibre',
    libelle: 'Sessions avant équilibre',
    largeur: '35%',
    alignement: 'texte',
    rendu: (l) =>
      l.sessionsAvantEquilibre !== null ? (
        <span className="text-ink-2">{l.sessionsAvantEquilibre} sessions</span>
      ) : (
        <span className="text-ink-3">{l.raisonIndisponible ?? TIRET_ABSENT}</span>
      ),
  },
];

const COLONNES_EMPREINTE: ReadonlyArray<ColonneTableau<QuantitePhysiqueIngredientContrat>> = [
  {
    cle: 'nom',
    libelle: 'Ingrédient',
    largeur: '34%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (l) => l.nom,
  },
  {
    cle: 'categorie',
    libelle: 'Catégorie',
    largeur: '22%',
    alignement: 'texte',
    rendu: (l) => LIBELLE_CATEGORIE_INGREDIENT[l.categorie],
  },
  {
    cle: 'quantiteRecue',
    libelle: 'Quantité reçue',
    largeur: '44%',
    alignement: 'nombre',
    rendu: (l) => `${l.quantiteRecue.toLocaleString('fr-BE')} ${LIBELLES_UNITE[l.uniteReference]}`,
  },
];

export default function Equipements() {
  const [etat, setEtat] = useState<EtatEcran>({ statut: 'chargement' });
  const [diagnostic, setDiagnostic] = useState<EtatDiagnostic>({ statut: 'chargement' });
  const [pointEquilibre, setPointEquilibre] = useState<EtatPointEquilibre>({
    statut: 'chargement',
  });
  const [empreinte, setEmpreinte] = useState<EtatEmpreinte>({ statut: 'chargement' });
  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [brouillon, setBrouillon] = useState<Brouillon>(BROUILLON_VIDE);
  const [champsEnErreur, setChampsEnErreur] = useState<ChampsEnErreur>({});
  const [erreurFormulaire, setErreurFormulaire] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState<EtatEnregistrement>({ phase: 'inchange' });
  const [afficherRetires, setAfficherRetires] = useState(false);

  const formulaireRef = useRef<HTMLFormElement>(null);

  const charger = useCallback(async (): Promise<{
    equipements: Equipement[];
    puissanceTotaleEnServiceW: number;
  }> => {
    const reponse = await requeteApi<unknown>('/equipements');
    const parsee = schemaListeEquipements.parse(reponse);
    return {
      equipements: parsee.data,
      puissanceTotaleEnServiceW: parsee.meta.puissanceTotaleEnServiceW,
    };
  }, []);

  const chargerDiagnostic = useCallback(async (): Promise<{
    lignes: DiagnosticPuissanceLieuContrat[];
    nbEquipementsEnService: number;
  }> => {
    const reponse = await requeteApi<unknown>('/equipements/diagnostic-puissance');
    const parsee = schemaListeDiagnosticsPuissance.parse(reponse);
    return { lignes: parsee.data, nbEquipementsEnService: parsee.meta.nbEquipementsEnService };
  }, []);

  const chargerPointEquilibre =
    useCallback(async (): Promise<ListePointsEquilibreAutoproduction> => {
      const reponse = await requeteApi<unknown>('/equipements/point-equilibre-autoproduction');
      return schemaListePointsEquilibreAutoproduction.parse(reponse);
    }, []);

  const chargerEmpreinte = useCallback(async (): Promise<EmpreinteQuantitesPhysiquesContrat> => {
    const reponse = await requeteApi<unknown>('/equipements/empreinte-quantites-physiques');
    return schemaEmpreinteQuantitesPhysiques.parse(reponse);
  }, []);

  useEffect(() => {
    let annule = false;

    charger()
      .then(({ equipements, puissanceTotaleEnServiceW }) => {
        if (annule) return;
        setEtat({ statut: 'pret', equipements, puissanceTotaleEnServiceW });
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

    chargerDiagnostic()
      .then(({ lignes, nbEquipementsEnService }) => {
        if (annule) return;
        setDiagnostic({ statut: 'pret', lignes, nbEquipementsEnService });
      })
      .catch(() => {
        if (annule) return;
        setDiagnostic({ statut: 'erreur' });
      });

    chargerPointEquilibre()
      .then((reponse) => {
        if (annule) return;
        setPointEquilibre({ statut: 'pret', reponse });
      })
      .catch(() => {
        if (annule) return;
        setPointEquilibre({ statut: 'erreur' });
      });

    chargerEmpreinte()
      .then((reponse) => {
        if (annule) return;
        setEmpreinte({ statut: 'pret', reponse });
      })
      .catch(() => {
        if (annule) return;
        setEmpreinte({ statut: 'erreur' });
      });

    return () => {
      annule = true;
    };
  }, [charger, chargerDiagnostic, chargerPointEquilibre, chargerEmpreinte]);

  const equipements = useMemo(() => (etat.statut === 'pret' ? etat.equipements : []), [etat]);

  const visibles = useMemo(
    () => equipements.filter((e) => afficherRetires || e.actif),
    [equipements, afficherRetires],
  );

  const selection = useMemo(
    () => equipements.find((e) => e.id === selectionId) ?? null,
    [equipements, selectionId],
  );

  function choisir(equipement: Equipement): void {
    setSelectionId(equipement.id);
    setBrouillon(versBrouillon(equipement));
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
    // justification complète, partagée avec Ingrédients, Produits et Lieux de
    // marché.
    setChampsEnErreur(champsEnErreurApresModification);
  }

  function focaliserPremierChampFautif(champs: ChampsEnErreur): void {
    const premier = Object.keys(champs)[0];
    if (premier === undefined) return;
    formulaireRef.current?.querySelector<HTMLElement>(`[name="${premier}"]`)?.focus();
  }

  function rafraichirDiagnostic(): void {
    chargerDiagnostic()
      .then(({ lignes, nbEquipementsEnService }) =>
        setDiagnostic({ statut: 'pret', lignes, nbEquipementsEnService }),
      )
      .catch(() => setDiagnostic({ statut: 'erreur' }));
  }

  function enregistrer(): void {
    // Garde contre la double écriture (défaut connu corrigé le 28/09/2026) :
    // le bouton « Enregistrer » est `disabled` pendant l'envoi, mais Ctrl+S
    // appelle cette fonction directement depuis le conteneur, sans passer
    // par lui. Sans ce retour, un second Ctrl+S repartait en réseau.
    if (enregistrement.phase === 'enregistrement') return;
    const corps = {
      nom: brouillon.nom,
      type: brouillon.type === '' ? null : brouillon.type,
      puissanceW: nombreSaisi(brouillon.puissanceW),
      enService: brouillon.enService,
      notes: brouillon.notes,
    };

    // Le MÊME schéma que le serveur, rejoué avant tout aller-retour.
    const verification = schemaSaisieEquipement.safeParse(corps);
    if (!verification.success) {
      const champs = champsDepuisErreurZod(verification.error);
      setChampsEnErreur(champs);
      focaliserPremierChampFautif(champs);
      setEnregistrement({ phase: 'modifie' });
      return;
    }

    setErreurFormulaire(null);
    setEnregistrement({ phase: 'enregistrement' });

    const chemin = selectionId === null ? '/equipements' : `/equipements/${selectionId}`;
    const methode = selectionId === null ? 'POST' : 'PATCH';

    requeteApi<unknown>(chemin, { method: methode, body: JSON.stringify(corps) })
      .then(async (reponse) => {
        const enregistre = schemaEquipement.parse(reponse);
        const { equipements: liste, puissanceTotaleEnServiceW } = await charger();
        setEtat({ statut: 'pret', equipements: liste, puissanceTotaleEnServiceW });
        setSelectionId(enregistre.id);
        setBrouillon(versBrouillon(enregistre));
        setChampsEnErreur({});
        setEnregistrement({ phase: 'enregistre', heure: heureCourante() });
        rafraichirDiagnostic();
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

    requeteApi<unknown>(`/equipements/${selection.id}/activite`, {
      method: 'PATCH',
      body: JSON.stringify({ actif: !selection.actif }),
    })
      .then(async (reponse) => {
        const modifie = schemaEquipement.parse(reponse);
        const { equipements: liste, puissanceTotaleEnServiceW } = await charger();
        setEtat({ statut: 'pret', equipements: liste, puissanceTotaleEnServiceW });
        setBrouillon(versBrouillon(modifie));
        setEnregistrement({ phase: 'enregistre', heure: heureCourante() });
        rafraichirDiagnostic();
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
        <h1 className="text-lg text-ink">Équipements électriques</h1>
        <button type="button" onClick={nouveau} className={CLASSE_BOUTON_PRIMAIRE}>
          Nouvel équipement
        </button>
      </div>

      <div className="grid grid-cols-1 items-start gap-bloc lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        {/* ═══ Liste ══════════════════════════════════════════════════════ */}
        <Panneau titre="Équipements" sansRembourrage>
          <div className="border-b border-line px-4 py-2">
            <label className="flex items-center gap-groupe text-sm text-ink-2">
              <input
                type="checkbox"
                checked={afficherRetires}
                onChange={(evenement) => setAfficherRetires(evenement.target.checked)}
              />
              Afficher aussi les équipements retirés
            </label>
          </div>

          {etat.statut === 'chargement' && (
            <p className="px-4 py-2 text-sm text-ink-3">Chargement des équipements…</p>
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
              cleLigne={(e) => e.id}
              total={equipements.length}
              libelleEntite="équipements"
              {...(selectionId !== null ? { ligneSelectionneeCle: selectionId } : {})}
              onSelectionnerLigne={choisir}
              etatVide={
                equipements.length > 0 ? (
                  <EtatVide
                    variante="filtre"
                    explicationFiltre={
                      equipements.length > 1
                        ? `Les ${equipements.length} équipements enregistrés sont tous retirés, et le filtre les masque.`
                        : "L'unique équipement enregistré est retiré, et le filtre le masque."
                    }
                    onReinitialiser={() => setAfficherRetires(true)}
                  />
                ) : (
                  <EtatVide
                    variante="premier-lancement"
                    titre="Aucun équipement électrique"
                    explication="Déclarez chaque radiateur, éclairage ou terminal de paiement du stand : sa puissance, relevée sur la plaque signalétique, sert au diagnostic de disjonction ci-dessous."
                    action={{ libelle: 'Créer un équipement', onClick: nouveau }}
                  />
                )
              }
            />
          )}
        </Panneau>

        {/* ═══ Fiche ══════════════════════════════════════════════════════ */}
        <Panneau titre={selection === null ? 'Nouvel équipement' : selection.nom}>
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
              libelle="Nom de l'équipement"
              valeur={brouillon.nom}
              onChange={(v) => modifier('nom', v)}
              erreur={champsEnErreur['nom']}
              obligatoire
            />

            <div className="grid grid-cols-2 gap-groupe">
              <ChampSelect
                nom="type"
                libelle="Type"
                valeur={brouillon.type}
                onChange={(v) => modifier('type', v)}
                erreur={champsEnErreur['type']}
                options={schemaTypeEquipement.options.map((type) => ({
                  valeur: type,
                  libelle: LIBELLES_TYPE[type],
                }))}
                optionVide="—"
              />
              <ChampTexte
                nom="puissanceW"
                libelle="Puissance (W)"
                valeur={brouillon.puissanceW}
                onChange={(v) => modifier('puissanceW', v)}
                erreur={champsEnErreur['puissanceW']}
                numerique="entier"
                aide="Relevée sur la plaque signalétique de l'appareil."
              />
            </div>

            <label className="flex items-center gap-groupe text-sm text-ink-2">
              <input
                name="enService"
                type="checkbox"
                checked={brouillon.enService}
                onChange={(evenement) => modifier('enService', evenement.target.checked)}
              />
              En service (part réellement au marché)
            </label>
            <p className="text-xs text-ink-3">
              Décochez pour déclarer un appareil en comparaison avant achat : il n’entre alors ni
              dans la puissance requise du diagnostic ci-dessous, ni dans un coût de session.
            </p>

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
                    {selection.actif ? 'Retirer' : 'Remettre en service'}
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

            {selection !== null && selection.nbUtilisations > 0 && (
              <p className="text-xs text-ink-3">
                Un équipement ne se supprime pas : {selection.nbUtilisations} session(s) ont une
                durée d’utilisation enregistrée pour lui, et c’est une donnée de coût conservée.
                Retiré, il disparaît des listes de choix mais reste dans l’historique.
              </p>
            )}
          </form>
        </Panneau>
      </div>

      {/* ═══ Diagnostic de puissance — le point central de la fiche ═══════ */}
      <Panneau titre="Diagnostic de disjonction, par lieu" sansRembourrage>
        <div className="border-b border-line px-4 py-2 text-xs text-ink-3">
          Puissance requise = somme de{' '}
          {
            /* `nbEquipementsEnService` (`meta`, `schemaListeDiagnosticsPuissance`,
               docs/21-CHAMPS-NON-LUS.md §2.2) : COMBIEN d'équipements composent la
               somme, jamais montré avant ce correctif — seul le total en watts
               l'était. */
            diagnostic.statut === 'pret'
              ? `${diagnostic.nbEquipementsEnService} équipement${diagnostic.nbEquipementsEnService > 1 ? 's' : ''}`
              : '…'
          }{' '}
          EN SERVICE ({etat.statut === 'pret' ? `${etat.puissanceTotaleEnServiceW} W` : '…'}).
          Comparée à la puissance disponible déclarée de chaque lieu actif (écran Lieux de marché).
          La disponibilité inconnue n’est jamais lue comme « pas de risque ».
        </div>

        {diagnostic.statut === 'chargement' && (
          <p className="px-4 py-2 text-sm text-ink-3">Calcul du diagnostic…</p>
        )}

        {diagnostic.statut === 'erreur' && (
          <div className="px-4 py-2">
            <MessageErreur message="Impossible de calculer le diagnostic de puissance pour le moment." />
          </div>
        )}

        {diagnostic.statut === 'pret' &&
          (diagnostic.lignes.length === 0 ? (
            <EtatVide
              variante="normal"
              texte="Aucun lieu actif à comparer : créez un lieu de marché avec sa puissance disponible."
            />
          ) : (
            <ul>
              {diagnostic.lignes.map((ligne) => (
                <li
                  key={ligne.lieuId}
                  className="flex items-center justify-between gap-groupe border-b border-line px-4 py-2 text-sm last:border-b-0"
                >
                  <span className="text-ink">{ligne.lieuNom}</span>
                  <span className="text-ink-2">
                    {ouTiret(ligne.puissanceDisponibleW, (w) => `${w} W disponibles`)}
                  </span>
                  <span
                    className={`inline-flex items-center gap-groupe ${
                      ligne.risqueDisjonction === true
                        ? 'text-depassement'
                        : ligne.risqueDisjonction === false
                          ? 'text-conforme'
                          : 'text-ink-3'
                    }`}
                  >
                    {ligne.risqueDisjonction !== null && (
                      <span aria-hidden="true">
                        {GLYPHE_STATUT[ligne.risqueDisjonction ? 'depassement' : 'conforme']}
                      </span>
                    )}
                    {ligne.avertissement ??
                      (ligne.risqueDisjonction === false
                        ? // `margeW` (docs/21-CHAMPS-NON-LUS.md §2.1) : le risque
                          // se lisait en booléen, jamais la marge réelle. Toujours
                          // non-null ici — `diagnosticPuissanceLieu` ne rend
                          // `risqueDisjonction === false` que lorsque `margeW`
                          // l'est aussi (`packages/core/src/energie.ts`).
                          `Marge de ${ligne.margeW !== null ? formaterEcartWatts(ligne.margeW) : TIRET_ABSENT} avant disjonction.`
                        : TIRET_ABSENT)}
                  </span>
                </li>
              ))}
            </ul>
          ))}
      </Panneau>

      {/* ═══ Point d'équilibre solaire / éolien (docs/demandes/17 §3) ══════ */}
      <Panneau titre="Point d'équilibre solaire / éolien" sansRembourrage>
        <div className="border-b border-line px-4 py-2 text-xs text-ink-3">
          Au bout de combien de sessions une installation (immobilisation existante) est-elle
          remboursée par l’électricité qu’on ne paie plus ?
          {pointEquilibre.statut === 'pret' && (
            <>
              {' '}
              Coût d’énergie moyen évité par session :{' '}
              {pointEquilibre.reponse.meta.coutEnergieEviteParSessionCents !== null ? (
                <span className="text-ink-2">
                  {formaterMontant(pointEquilibre.reponse.meta.coutEnergieEviteParSessionCents)}{' '}
                  (mesuré sur {pointEquilibre.reponse.meta.nbSessionsPriseEnCompte} session
                  {pointEquilibre.reponse.meta.nbSessionsPriseEnCompte > 1 ? 's' : ''})
                </span>
              ) : (
                <span>
                  {pointEquilibre.reponse.meta.raisonCoutEviteIndisponible ?? TIRET_ABSENT}
                </span>
              )}
            </>
          )}
        </div>

        {pointEquilibre.statut === 'pret' && (
          <div
            role="note"
            className="border-b border-line bg-surface-sunken px-4 py-2 text-xs text-ink-2"
          >
            {pointEquilibre.reponse.meta.avertissement}
          </div>
        )}

        {pointEquilibre.statut === 'chargement' && (
          <p className="px-4 py-2 text-sm text-ink-3">Calcul du point d’équilibre…</p>
        )}

        {pointEquilibre.statut === 'erreur' && (
          <div className="px-4 py-2">
            <MessageErreur message="Impossible de calculer le point d’équilibre pour le moment." />
          </div>
        )}

        {pointEquilibre.statut === 'pret' && (
          <Tableau
            colonnes={COLONNES_POINT_EQUILIBRE}
            lignes={pointEquilibre.reponse.data}
            cleLigne={(l) => l.immobilisationId}
            total={pointEquilibre.reponse.data.length}
            libelleEntite="immobilisations"
            etatVide={
              <EtatVide
                variante="normal"
                texte="Aucune immobilisation enregistrée : créez celle des panneaux solaires ou de l’éolienne depuis l’écran Comptabilité pour voir son point d’équilibre ici."
              />
            }
          />
        )}
      </Panneau>

      {/* ═══ Empreinte — quantités physiques (docs/demandes/17 §4) ════════ */}
      <Panneau titre="Empreinte — quantités physiques" sansRembourrage>
        {empreinte.statut === 'pret' && (
          <div
            role="note"
            className="border-b border-line bg-surface-sunken px-4 py-2 text-xs text-ink-2"
          >
            {empreinte.reponse.meta.avertissementConversionCarbone}
          </div>
        )}

        {empreinte.statut === 'pret' && (
          <div className="flex flex-wrap gap-groupe border-b border-line px-4 py-2 text-xs text-ink-3">
            <span>
              Kilométrage parcouru (aller-retour) :{' '}
              <span className="text-ink-2">
                {empreinte.reponse.meta.kilometresParcourus.toLocaleString('fr-BE')} km
              </span>
              {empreinte.reponse.meta.nbSessionsDistanceInconnue > 0 && (
                <>
                  {' '}
                  — {empreinte.reponse.meta.nbSessionsDistanceInconnue} session(s) sans distance
                  connue, non comptée(s) (plancher, pas une mesure complète)
                </>
              )}
            </span>
            <span>
              Électricité consommée (tous équipements confondus) :{' '}
              <span className="text-ink-2">
                {empreinte.reponse.meta.energieElectriqueKwh.toLocaleString('fr-BE', {
                  maximumFractionDigits: 2,
                })}{' '}
                kWh
              </span>
            </span>
          </div>
        )}

        {empreinte.statut === 'chargement' && (
          <p className="px-4 py-2 text-sm text-ink-3">Calcul des quantités physiques…</p>
        )}

        {empreinte.statut === 'erreur' && (
          <div className="px-4 py-2">
            <MessageErreur message="Impossible de calculer l’empreinte pour le moment." />
          </div>
        )}

        {empreinte.statut === 'pret' && (
          <Tableau
            colonnes={COLONNES_EMPREINTE}
            lignes={empreinte.reponse.data}
            cleLigne={(l) => l.ingredientId}
            total={empreinte.reponse.data.length}
            libelleEntite="ingrédients"
            etatVide={
              <EtatVide
                variante="normal"
                texte="Aucune réception de marchandise enregistrée : les quantités physiques apparaîtront ici dès la première réception."
              />
            }
          />
        )}
      </Panneau>
    </div>
  );
}
