/**
 * Écran `Sessions` MONTÉ — la clôture d'une journée de marché.
 *
 * ═══ Pourquoi ce fichier existe ═══
 *
 * `Sessions.test.tsx`, à côté, teste des fonctions pures et du balisage rendu
 * (`renderToStaticMarkup`). Il reste valable et n'est pas touché. Mais il ne
 * pouvait rien dire de la clôture elle-même : mesuré le 01/08/2026, l'écran —
 * 4 575 lignes, le plus gros du dépôt — n'était couvert qu'à 12,62 %.
 *
 * `cloturerSession()` porte QUINZE refus de saisie décidés côté écran, sans
 * réseau. Chacun bloque la clôture d'une journée entière, et aucun n'avait
 * jamais été exécuté par un test : ils ne s'atteignent qu'après le chargement
 * de huit listes, l'ouverture d'une session `planifiee`, et une frappe.
 *
 * Le seizième refus vient du serveur, et sa NATURE décide du registre d'alerte
 * (métier ou technique, correctif du 01/08/2026) — c'est aussi vérifié ici.
 *
 * Ce que ce fichier ne prouve PAS : que le serveur accepte ce que l'écran
 * envoie. Il prouve ce que l'écran refuse d'envoyer, et ce qu'il affiche.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
// Valeur, et non type : un montant affiché ne se compare JAMAIS à un littéral
// tapé à la main — `formaterMontant` passe par `Intl`, dont les séparateurs
// sont des espaces insécables invisibles dans une source.
import { formaterEuros, formaterMontant } from '@batte/core';
import type {
  Equipement,
  LieuComplet,
  LieuMarcheContrat,
  ProduitVendable,
  ResultatCloture,
  SessionDetail,
  SessionResume,
  TableauSeuils,
} from '@batte/core';

// `ErreurApi` reste la VRAIE classe : `natureDuRefus` fait un `instanceof`
// dessus pour distinguer un 422 métier d'un 500 technique. Une classe factice
// ferait passer TOUS les refus pour techniques — le test serait vert pour la
// mauvaise raison, exactement ce que `BoutonDocument.montage.test.tsx` évite.
import type * as ModuleApi from '../lib/api';

vi.mock('../lib/api', async (importerReel) => {
  // `import type * as …` et non `typeof import(...)` : la règle ESLint
  // `consistent-type-imports` interdit la seconde forme — même formulation que
  // `BoutonDocument.montage.test.tsx`, le modèle de ce dépôt.
  const reel = await importerReel<typeof ModuleApi>();
  return { ...reel, requeteApi: vi.fn() };
});

const { ErreurApi, requeteApi } = await import('../lib/api');
const { default: Sessions } = await import('./Sessions');

const appelApi = vi.mocked(requeteApi);

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * TOUTES les fixtures de ce fichier sont ANNOTÉES avec leur type de contrat.
 *
 * Ce n'est pas de la cosmétique : un littéral nu ne fait rien rougir quand il
 * s'écarte du schéma Zod que le composant va lui appliquer. La réponse part
 * alors dans un `.catch()`, et le test mesure un chemin d'erreur en croyant
 * mesurer celui du succès — deux fois le cas ici le 01/08/2026
 * (`RESULTAT_CLOTURE_MINIMAL` puis `LIEU_BATTE_COMPLET`). L'annotation fait
 * échouer `tsc` immédiatement, avant même d'exécuter un test.
 */

/** `schemaLieuMarche` (`GET /api/lieux`) n'expose que ces cinq champs. */
const LIEU_BATTE: LieuMarcheContrat = {
  id: 'lieu-batte',
  nom: 'La Batte',
  heureDebut: '08:00',
  heureFin: '14:30',
  tarifEmplacementCents: 1_500,
};

/**
 * `schemaLieuComplet` (`GET /api/referentiel/lieux`), bien plus riche — mêmes
 * champs que le patron de `LieuxMarche.montage.test.tsx`.
 *
 * `facturationElectricite: 'aucune'` : c'est le cas RÉEL de La Batte
 * (CLAUDE.md §6, chaîne du froid passive, cuisson au gaz), et c'est la valeur
 * qui MASQUE la section « équipements électriques » à la clôture. L'enum du
 * contrat n'accepte que `compteur | forfait | comprise | aucune`.
 */
const LIEU_BATTE_COMPLET: LieuComplet = {
  ...LIEU_BATTE,
  adresse: null,
  latitude: null,
  longitude: null,
  jourSemaine: 0,
  modeTarification: null,
  metresLineaires: null,
  distanceKm: 23,
  facturationElectricite: 'aucune',
  puissanceDisponibleW: null,
  notes: null,
  actif: true,
  nbSessions: 12,
  distanceCalculAutomatique: null,
};

/**
 * Le lieu RÉEL du porteur, mesuré le 01/08/2026 : `tarif_emplacement_cents`
 * n'a jamais été renseigné. C'est donc `null` qui décrit sa base, pas 1 500 —
 * et c'est la seule fixture capable de voir le défaut du champ « Emplacement »
 * pré-rempli à « 0,00 ».
 */
const LIEU_SANS_TARIF: LieuMarcheContrat = {
  ...LIEU_BATTE,
  id: 'lieu-sans-tarif',
  nom: 'Marché sans tarif connu',
  tarifEmplacementCents: null,
};

/** Le MÊME lieu, mais facturé au compteur : la section équipements s'affiche. */
const LIEU_AVEC_COMPTEUR: LieuComplet = {
  ...LIEU_BATTE_COMPLET,
  id: 'lieu-avec-courant',
  nom: 'Halle couverte',
  facturationElectricite: 'compteur',
  puissanceDisponibleW: 3_500,
};

const SESSION_PLANIFIEE: SessionResume = {
  id: 'ses-1',
  numero: 'SM-2026-0002',
  lieuId: 'lieu-batte',
  lieuNom: 'La Batte',
  dateSession: '2026-08-02',
  statut: 'planifiee',
  caTotalCents: null,
  margeNetteCents: null,
  tauxEcoulementBp: null,
  ecartCaisseCents: null,
  crepesVendues: 0,
  exclureDuModele: false,
  evenementId: null,
  evenementNom: null,
};

function detailSession(surcharges: Partial<SessionDetail> = {}): SessionDetail {
  return {
    ...SESSION_PLANIFIEE,
    heureDebutReelle: null,
    heureFinReelle: null,
    fondsCaisseInitialCents: 5_000,
    especesCompteesCents: null,
    caEspecesCents: null,
    caCarteCents: null,
    caTransformeCents: null,
    caRevenduCents: null,
    caSurPlaceCents: null,
    coutMatiereCents: null,
    commissionCarteCents: null,
    fraisEmplacementCents: 0,
    fraisDeplacementCents: 0,
    fraisGazCents: 0,
    fraisDiversCents: 0,
    fraisEnergieCents: 0,
    distanceReelleKm: null,
    coutDeplacementReelSessionCents: null,
    coutDeplacementReelDetourAchatsCents: null,
    coutDeplacementReelTotalCents: null,
    crepesProduites: 0,
    modeCloture: null,
    volumeRestantMesureMl: null,
    crepesInvendues: 0,
    crepesCassees: 0,
    margeBruteCents: null,
    margeParHeureCents: null,
    panierMoyenCents: null,
    prixMoyenParArticleCents: null,
    coutMatiereParCrepeCents: null,
    coutCompletParCrepeVendueCents: null,
    meteoPrevue: null,
    meteoReelle: null,
    dateCloture: null,
    notesQualitatives: null,
    motifExclusion: null,
    ventes: [],
    fraisDetail: [],
    ...surcharges,
  };
}

const CREPE_SUCRE: ProduitVendable = {
  id: 'prod-crepe',
  nom: 'Crêpe sucre',
  nature: 'transforme',
  prixCents: 250,
  nbCrepes: 1,
  consommationSurPlace: false,
  categorie: null,
};

const TABLEAU_SEUILS: TableauSeuils = {
  data: [
    {
      cle: 'franchise_tva',
      libelle: 'Franchise TVA',
      realiseCents: 1_200_000,
      plafondCents: 2_500_000,
      partBp: 4_800,
      projectionFinAnneeCents: 2_000_000,
      depassementProjete: false,
      source: 'parametre',
      toleranceE604b: { plafondCents: 2_750_000, statut: 'conforme' as const },
    },
  ],
  meta: {
    annee: 2026,
    sessionsTenues: 12,
    caTransformeCents: 900_000,
    caRevenduCents: 300_000,
    partRevenduBp: 2_500,
    seuilAlerteBp: 8_000,
  },
};

/**
 * `Equipement[]` et `LieuComplet[]`, jamais `unknown[]` : un `unknown[]`
 * rouvre exactement la porte que l'annotation des fixtures vient de fermer —
 * il laisse passer n'importe quel littéral vers un `schema.parse` qui le
 * refusera silencieusement à l'exécution.
 */
type Monde = {
  sessions?: SessionResume[];
  detail?: SessionDetail;
  produits?: ProduitVendable[];
  equipements?: Equipement[];
  lieuxComplets?: LieuComplet[];
  /**
   * `GET /lieux` (`schemaLieuMarche`) — la liste du SÉLECTEUR de création, et
   * la seule source de `tarifEmplacementCents` pour le pré-remplissage des
   * frais. Distincte de `lieuxComplets` (`GET /referentiel/lieux`), qui sert
   * à l'électricité : les deux routes existent, les confondre ferait passer
   * un test pour l'autre.
   */
  lieux?: LieuMarcheContrat[];
  /** Réponse de `POST /sessions`, quand le test passe par la création. */
  sessionCreee?: SessionDetail;
};

/**
 * Routeur des HUIT lectures du montage. Une seule d'entre elles manquante
 * laisserait l'écran dans un état de chargement qu'aucun message n'explique —
 * c'est pourquoi un chemin non prévu LÈVE plutôt que de rendre `undefined`.
 */
function routerLectures(monde: Monde = {}): void {
  const sessions = monde.sessions ?? [SESSION_PLANIFIEE];
  const detail = monde.detail ?? detailSession();
  const produits = monde.produits ?? [CREPE_SUCRE];
  const equipements = monde.equipements ?? [];
  const lieuxComplets = monde.lieuxComplets ?? [LIEU_BATTE_COMPLET];
  const lieux = monde.lieux ?? [LIEU_BATTE];

  appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
    if (chemin === '/sessions' && options?.method === 'POST') {
      if (monde.sessionCreee === undefined) {
        throw new Error('Ce test ne prévoit pas de création de session.');
      }
      return monde.sessionCreee;
    }
    if (chemin === '/sessions') return { data: sessions, meta: { total: sessions.length } };
    if (chemin === '/seuils') return TABLEAU_SEUILS;
    if (chemin === '/productions') return { data: [], meta: { total: 0 } };
    if (chemin === '/lieux') return { data: lieux, meta: { total: lieux.length } };
    if (chemin === '/referentiel/lieux')
      return { data: lieuxComplets, meta: { total: lieuxComplets.length } };
    if (chemin === '/produits-vendables')
      return { data: produits, meta: { total: produits.length } };
    if (chemin === '/equipements')
      return {
        data: equipements,
        meta: { total: equipements.length, puissanceTotaleEnServiceW: 0 },
      };
    if (chemin === '/opportunites')
      return {
        data: [],
        meta: {
          total: 0,
          coutKilometriqueCentsParKm: 35,
          coutKilometriqueSource: 'parametre',
          coutsDisponibles: true,
          avertissementCouts: null,
          avertissementTauxPriseEntreprise: null,
        },
      };
    if (chemin === `/sessions/${detail.id}`) return detail;
    throw new Error(`Chemin non prévu par la fixture : ${chemin}`);
  });
}

function monter(): void {
  render(
    <MemoryRouter>
      <Sessions />
    </MemoryRouter>,
  );
}

/**
 * Monte l'écran, ouvre la session `planifiee` et attend le formulaire de
 * clôture. C'est le point de départ des quinze refus.
 */
async function ouvrirCloture(monde: Monde = {}): Promise<ReturnType<typeof userEvent.setup>> {
  const utilisateur = userEvent.setup();
  routerLectures(monde);
  monter();
  // La liste ne porte PAS de colonne « Numéro » (Date, Lieu, Statut, CA,
  // Marge, Écoul., Écart caisse) : on désigne la rangée par sa DATE, qui est
  // ce que l'utilisateur lit lui-même pour retrouver son marché.
  await utilisateur.click(await screen.findByText('02/08/2026'));
  await screen.findByLabelText('Espèces comptées (€)');
  return utilisateur;
}

/**
 * Crée une session sur `lieu`, puis attend l'ouverture du formulaire.
 *
 * C'est le SEUL chemin de l'écran qui transmette les défauts du lieu à
 * `initialiserFormulaireEdition` : rouvrir une session déjà créée
 * (`ouvrirEditionExistante`) lui passe `null`. Un test du pré-remplissage par
 * TARIF DE LIEU doit donc obligatoirement passer par ici — mesuré le
 * 01/08/2026, après avoir cherché en vain à l'atteindre depuis la liste.
 */
async function creerSessionSurLieu(lieu: LieuMarcheContrat): Promise<void> {
  const utilisateur = userEvent.setup();
  const creee = detailSession({
    id: 'ses-neuve',
    numero: 'SM-2026-0009',
    lieuId: lieu.id,
    lieuNom: lieu.nom,
  });
  // `sessions` reste NON VIDE : l'état vide de la liste porte lui aussi un
  // bouton « Nouvelle session », et deux boutons du même nom rendraient la
  // requête `getByRole` ambiguë — le test échouerait pour une raison sans
  // rapport avec ce qu'il mesure.
  routerLectures({ lieux: [lieu], detail: creee, sessionCreee: creee });
  monter();
  await utilisateur.click(await screen.findByRole('button', { name: 'Nouvelle session' }));
  await utilisateur.click(screen.getByRole('button', { name: 'Créer et ouvrir' }));
  await screen.findByLabelText('Espèces comptées (€)');
}

const boutonEnregistrer = () => screen.getByRole('button', { name: /^Enregistrer/ });

/** Ce que l'écran affiche quand il refuse une saisie : un `role="alert"`. */
const messageRefus = () => screen.getByRole('alert');

/** Classe du registre d'alerte MÉTIER — celui qui doit rester rare. */
const CLASSE_ALERTE_METIER = 'bg-depassement-bg';

/**
 * Remplit le minimum pour qu'une clôture soit ACCEPTÉE par les quinze
 * contrôles. Chaque test de refus casse ensuite UN seul de ces champs : sans ce
 * point de départ valide, on ne saurait pas lequel des quinze a parlé.
 */
async function remplirClotureValide(
  utilisateur: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  // Au moins UNE vente : c'est le tout premier contrôle de `cloturerSession`
  // (« Saisissez au moins une vente avant de clôturer. »), et sans elle les
  // quinze suivants ne seraient jamais atteints — chaque test croirait alors
  // vérifier son refus alors qu'il verrait toujours celui-ci.
  await utilisateur.type(
    screen.getByRole('textbox', { name: 'Quantité vendue — Crêpe sucre' }),
    '80',
  );
  await utilisateur.type(screen.getByLabelText('Espèces comptées (€)'), '120,00');
  await utilisateur.type(screen.getByLabelText('SumUp — carte (€)'), '80,00');
  await utilisateur.type(screen.getByLabelText('Produites'), '100');
  await utilisateur.type(screen.getByLabelText('Invendues'), '10');
  await utilisateur.type(screen.getByLabelText('Cassées'), '2');
}

const RESULTAT_CLOTURE_MINIMAL: ResultatCloture = {
  ...detailSession({
    statut: 'cloturee',
    caTotalCents: 20_000,
    especesCompteesCents: 12_000,
    caCarteCents: 8_000,
    crepesProduites: 100,
    crepesInvendues: 10,
    crepesCassees: 2,
    dateCloture: '2026-08-02T18:00:00.000Z',
  }),
  resolutionVolume: null,
  imputationDeplacement: {
    coutSessionCents: null,
    coutDetourAchatsCents: null,
    // `coutTotalReelCents`, PAS `coutTotalCents` : le nom exact du contrat.
    // Une clé fautive ici faisait échouer `schemaResultatCloture.parse`, donc
    // basculer la clôture « réussie » dans le CATCH — un test qui croyait
    // vérifier le chemin de succès mesurait en réalité celui de l'erreur.
    // C'est la mutation S16 (reprise de focus supprimée) qui l'a révélé.
    coutTotalReelCents: null,
  },
  ecartsStock: [],
  avertissementEnergie: null,
  avertissementCoutMatiereTransforme: null,
};

/** Équipement ACTIF et EN SERVICE : les deux conditions pour être proposable. */
const CREPIERE_ELECTRIQUE: Equipement = {
  id: 'equ-1',
  nom: 'Crêpière électrique',
  type: 'cuisson',
  puissanceW: 3_000,
  enService: true,
  notes: null,
  actif: true,
  nbUtilisations: 4,
};

/**
 * Session tenue sur un lieu facturé au COMPTEUR — la seule configuration où la
 * section « équipements électriques » a un sens. Les trois pièces doivent
 * concorder : le lieu complet chargé, la session listée et son détail.
 */
const MONDE_AVEC_COURANT: Monde = {
  equipements: [CREPIERE_ELECTRIQUE],
  lieuxComplets: [LIEU_BATTE_COMPLET, LIEU_AVEC_COMPTEUR],
  sessions: [{ ...SESSION_PLANIFIEE, lieuId: 'lieu-avec-courant' }],
  detail: detailSession({ lieuId: 'lieu-avec-courant' }),
};

beforeEach(() => {
  appelApi.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   Chargements
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Sessions — chargement de la liste', () => {
  it('annonce le chargement tant que rien n’est revenu', () => {
    appelApi.mockImplementation(() => new Promise(() => {}));
    monter();

    expect(screen.getByText('Chargement des sessions…')).toBeInTheDocument();
  });

  it('un échec affiche le message français du serveur', async () => {
    appelApi.mockImplementation(async (chemin: string) => {
      if (chemin === '/sessions')
        throw new ErreurApi('La base est verrouillée par une sauvegarde.', {
          code: 'verrou',
          statut: 503,
        });
      throw new ErreurApi('Autre', { code: 'x', statut: 500 });
    });
    monter();

    expect(
      await screen.findByText('La base est verrouillée par une sauvegarde.'),
    ).toBeInTheDocument();
  });

  it('ouvrir une session `planifiee` ouvre le FORMULAIRE de clôture, pas une fiche en lecture', async () => {
    await ouvrirCloture();

    expect(screen.getByLabelText('Fonds de caisse (€)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Enregistrer/ })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   LES QUINZE REFUS DE SAISIE — chacun bloque une journée entière
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Sessions — les refus de saisie de la clôture, un par un', () => {
  /** Casse un champ, tente la clôture, et rend le message affiché. */
  async function refusApres(
    preparer: (utilisateur: ReturnType<typeof userEvent.setup>) => Promise<void>,
    monde: Monde = {},
  ): Promise<string> {
    const utilisateur = await ouvrirCloture(monde);
    await remplirClotureValide(utilisateur);
    await preparer(utilisateur);
    appelApi.mockClear();
    await utilisateur.click(boutonEnregistrer());
    // Aucun appel de clôture ne doit être parti : c'est le point du refus.
    expect(appelApi).not.toHaveBeenCalledWith('/sessions/ses-1/cloturer', expect.anything());
    return messageRefus().textContent ?? '';
  }

  it('0 · une clôture SANS aucune vente est refusée : une journée sans vente ne se clôture pas ainsi', async () => {
    const utilisateur = await ouvrirCloture();
    // Volontairement PAS de `remplirClotureValide` : c'est ce refus-là qu'on
    // veut voir, et il passe avant tous les autres.
    await utilisateur.click(boutonEnregistrer());

    expect(messageRefus()).toHaveTextContent('Saisissez au moins une vente avant de clôturer.');
    expect(appelApi).not.toHaveBeenCalledWith('/sessions/ses-1/cloturer', expect.anything());
  });

  it('1 · une quantité de vente illisible bloque, en NOMMANT le produit', async () => {
    const message = await refusApres(async (utilisateur) => {
      const quantite = screen.getByRole('textbox', { name: 'Quantité vendue — Crêpe sucre' });
      await utilisateur.clear(quantite);
      await utilisateur.type(quantite, 'plein');
    });
    expect(message).toBe(
      "La quantité de « Crêpe sucre » doit être un nombre entier de crêpes ou d'unités.",
    );
  });

  it('2 · un montant d’espèces illisible bloque, et le message dit ce qu’attend le champ', async () => {
    const message = await refusApres(async (utilisateur) => {
      const especes = screen.getByLabelText('Espèces comptées (€)');
      await utilisateur.clear(especes);
      await utilisateur.type(especes, 'beaucoup');
    });
    expect(message).toBe(
      "Le montant d'espèces comptées doit être un montant valide (0 si aucune espèce).",
    );
  });

  it('3 · un montant carte illisible bloque', async () => {
    const message = await refusApres(async (utilisateur) => {
      const carte = screen.getByLabelText('SumUp — carte (€)');
      await utilisateur.clear(carte);
      await utilisateur.type(carte, 'rien');
    });
    expect(message).toBe(
      'Le montant encaissé par carte doit être un montant valide (0 si aucun paiement carte).',
    );
  });

  it('4 · un fonds de caisse illisible bloque', async () => {
    const message = await refusApres(async (utilisateur) => {
      const fonds = screen.getByLabelText('Fonds de caisse (€)');
      await utilisateur.clear(fonds);
      await utilisateur.type(fonds, 'x');
    });
    expect(message).toBe('Le fonds de caisse initial doit être un montant valide.');
  });

  it('5 · un frais d’emplacement illisible bloque', async () => {
    const message = await refusApres(async (utilisateur) => {
      const frais = screen.getByLabelText(/^Emplacement/);
      await utilisateur.clear(frais);
      await utilisateur.type(frais, 'gratuit');
    });
    expect(message).toBe('Un des montants de frais saisis est invalide.');
  });

  it('6 · un frais de gaz illisible bloque avec le MÊME message : c’est le lot des frais', async () => {
    const message = await refusApres(async (utilisateur) => {
      const gaz = screen.getByLabelText(/^Gaz/);
      await utilisateur.clear(gaz);
      await utilisateur.type(gaz, '??');
    });
    expect(message).toBe('Un des montants de frais saisis est invalide.');
  });

  it('7 · des kilomètres réels illisibles bloquent, et le message donne DEUX exemples', async () => {
    const message = await refusApres(async (utilisateur) => {
      const km = screen.getByLabelText(/kilomètres réels/i);
      await utilisateur.clear(km);
      await utilisateur.type(km, 'aller-retour');
    });
    expect(message).toContain('Les kilomètres réels doivent être un nombre positif');
    expect(message).toContain('46 ou 48,5');
  });

  it('8 · un compteur d’invendues illisible bloque', async () => {
    const message = await refusApres(async (utilisateur) => {
      const invendues = screen.getByLabelText('Invendues');
      await utilisateur.clear(invendues);
      await utilisateur.type(invendues, 'quelques-unes');
    });
    expect(message).toBe(
      'Les compteurs d’invendues et de cassées doivent être des nombres entiers.',
    );
  });

  it('9 · un compteur de cassées illisible bloque avec le même message', async () => {
    const message = await refusApres(async (utilisateur) => {
      const cassees = screen.getByLabelText('Cassées');
      await utilisateur.clear(cassees);
      await utilisateur.type(cassees, '-');
    });
    expect(message).toBe(
      'Les compteurs d’invendues et de cassées doivent être des nombres entiers.',
    );
  });

  it('10 · un nombre de crêpes produites illisible bloque, en mode « crêpes »', async () => {
    const message = await refusApres(async (utilisateur) => {
      const produites = screen.getByLabelText('Produites');
      await utilisateur.clear(produites);
      await utilisateur.type(produites, 'toute la pâte');
    });
    expect(message).toBe('Le nombre de crêpes produites doit être un nombre entier.');
  });

  it('11 · un volume de pâte restante illisible bloque, en mode « volume »', async () => {
    const message = await refusApres(async (utilisateur) => {
      await utilisateur.click(screen.getByRole('radio', { name: 'Je compte la pâte restante' }));
      await utilisateur.type(screen.getByLabelText('Pâte restante'), 'un fond');
    });
    expect(message).toBe('Le volume de pâte restant doit être un nombre entier.');
  });

  it(
    '12 · les GRAMMES sont refusés côté écran : aucune densité de pâte n’est déclarée, ' +
      '`convertir` refuserait de toute façon — le dire ici évite un aller-retour pour rien',
    async () => {
      const message = await refusApres(async (utilisateur) => {
        await utilisateur.click(screen.getByRole('radio', { name: 'Je compte la pâte restante' }));
        await utilisateur.type(screen.getByLabelText('Pâte restante'), '800');
        await utilisateur.selectOptions(
          screen.getByRole('combobox', { name: 'Unité de la pâte restante' }),
          'g',
        );
      });
      expect(message).toContain('Les grammes ne sont pas pris en charge');
      expect(message).toContain('Saisissez ce volume en millilitres.');
      /*
        MESURE HONNÊTE : ce refus est produit par DEUX gardes indépendantes —
        celle-ci (`uniteVolumeRestant === 'g'`) et, une ligne plus bas,
        `apercuVolumeErreur`, qui vient de `convertir` levant `densite_manquante`
        sur le même intrant. Supprimer l'une laisse donc ce test vert (mutation
        S7, 01/08/2026). Ce n'est pas une fixture aveugle : le REFUS est bien
        prouvé. C'est une redondance du code — défense en profondeur assumée,
        signalée ici pour qu'aucun lecteur ne croie ce test attaché à l'une des
        deux en particulier.
      */
    },
  );

  it('13 · un nombre de tickets illisible bloque, et rappelle qu’on peut le laisser vide', async () => {
    const message = await refusApres(async (utilisateur) => {
      await utilisateur.type(screen.getByLabelText('Tickets (optionnel)'), 'plein');
    });
    expect(message).toContain('Le nombre de tickets doit être un entier positif');
    expect(message).toContain('laissez le champ vide');
  });

  it('14 · une température ILLISIBLE bloque, en nommant le moment du relevé', async () => {
    const message = await refusApres(async (utilisateur) => {
      await utilisateur.type(screen.getByLabelText(/^Température °C à l’arrivée/), 'froid');
    });
    expect(message).toContain('Le relevé de température à l’arrivée doit être un nombre');
    expect(message).toContain('ou laissé vide si non pris');
  });

  it('15 · une température saisie SANS équipement bloque — un relevé sans support ne trace rien', async () => {
    const message = await refusApres(async (utilisateur) => {
      await utilisateur.type(screen.getByLabelText(/^Température °C au retour/), '6');
      await utilisateur.clear(screen.getByLabelText(/^Équipement au retour/));
    });
    expect(message).toBe("Indiquez l'équipement mesuré pour le relevé de température au retour.");
  });

  it(
    '16 · une durée d’équipement illisible bloque, en NOMMANT l’appareil — mais seulement ' +
      'quand le lieu peut avoir du courant',
    async () => {
      const message = await refusApres(async (utilisateur) => {
        await utilisateur.type(
          screen.getByLabelText('Crêpière électrique — durée (min)'),
          'longtemps',
        );
      }, MONDE_AVEC_COURANT);
      expect(message).toContain("La durée d'utilisation de « Crêpière électrique »");
      expect(message).toContain('nombre entier de minutes');
    },
  );

  it(
    'contre-test : sur un lieu SANS électricité, la section équipements est MASQUÉE — ' +
      "l'électricité dépend du LIEU, pas du projet (CLAUDE.md §6)",
    async () => {
      await ouvrirCloture({ equipements: [CREPIERE_ELECTRIQUE] });

      /*
        C'est le contre-test qui rend le test 16 discriminant. Sans lui, une
        fixture dont la disponibilité électrique est INCONNUE — c'était le cas
        ici jusqu'au 01/08/2026, `LIEU_BATTE_COMPLET` ne passant pas son schéma
        — affiche la section dans TOUS les cas, et la surcharge « lieu avec
        courant » du test 16 ne change alors rien du tout.

        La Batte est bien un lieu `facturationElectricite: 'aucune'` : le champ
        de durée ne doit pas exister, et l'écran doit DIRE pourquoi.
      */
      expect(screen.queryByLabelText('Crêpière électrique — durée (min)')).not.toBeInTheDocument();
      expect(screen.getByText(/Ce lieu ne dispose d'aucune électricité/)).toBeInTheDocument();
    },
  );

  it('sur un lieu facturé au COMPTEUR, le même champ de durée existe', async () => {
    await ouvrirCloture(MONDE_AVEC_COURANT);

    expect(screen.getByLabelText('Crêpière électrique — durée (min)')).toBeInTheDocument();
    expect(screen.queryByText(/Ce lieu ne dispose d'aucune électricité/)).not.toBeInTheDocument();
  });

  it('un refus de saisie garde le registre d’alerte MÉTIER : le porteur a un geste à faire', async () => {
    const utilisateur = await ouvrirCloture();
    await remplirClotureValide(utilisateur);
    const especes = screen.getByLabelText('Espèces comptées (€)');
    await utilisateur.clear(especes);
    await utilisateur.type(especes, 'x');
    await utilisateur.click(boutonEnregistrer());

    expect(messageRefus().className).toContain(CLASSE_ALERTE_METIER);
  });

  it('un formulaire VALIDE ne déclenche AUCUN de ces refus et part sur le réseau', async () => {
    const utilisateur = await ouvrirCloture();
    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/sessions/ses-1/cloturer') return RESULTAT_CLOTURE_MINIMAL;
      return routeurBase?.(chemin, options);
    });

    await remplirClotureValide(utilisateur);
    await utilisateur.click(boutonEnregistrer());

    await waitFor(() =>
      expect(appelApi).toHaveBeenCalledWith(
        '/sessions/ses-1/cloturer',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    /*
      Discriminant du bloc entier : si ce test échouait, les seize au-dessus
      pourraient être verts parce que RIEN ne part jamais sur le réseau.

      L'assertion porte sur les MESSAGES de refus, pas sur l'absence de tout
      `role="alert"` : l'écran en contient d'autres, sans rapport avec la
      clôture (bandeaux de seuils, avertissements post-enregistrement).
    */
    expect(screen.queryByText(/doit être un montant valide/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Saisissez au moins une vente/)).not.toBeInTheDocument();
    expect(screen.queryByText(/doivent être des nombres entiers/)).not.toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Le seizième refus : celui du serveur, et sa NATURE
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Sessions — le refus du SERVEUR suit la nature de la réponse (correctif du 01/08/2026)', () => {
  async function cloturerAvecReponse(erreur: unknown): Promise<void> {
    const utilisateur = await ouvrirCloture();
    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/sessions/ses-1/cloturer') throw erreur;
      return routeurBase?.(chemin, options);
    });

    await remplirClotureValide(utilisateur);
    await utilisateur.click(boutonEnregistrer());
  }

  it('un 422 garde le registre d’alerte MÉTIER : il dit quoi corriger (D-093)', async () => {
    await cloturerAvecReponse(
      new ErreurApi('Le menu « Crêpe + café » a des prix désignés supérieurs au prix pratiqué.', {
        code: 'menu_incoherent',
        statut: 422,
      }),
    );

    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent('Crêpe + café');
    expect(alerte.className).toContain(CLASSE_ALERTE_METIER);
  });

  it('un 500 passe au registre NEUTRE : il n’y a aucune décision à prendre', async () => {
    await cloturerAvecReponse(
      new ErreurApi('Erreur inattendue du serveur.', { code: 'interne', statut: 500 }),
    );

    const message = await screen.findByText('Erreur inattendue du serveur.');
    // LE point du correctif : plus aucune couleur d'alerte métier sur ce chemin.
    const conteneur = message.closest('[role="alert"]') ?? message.parentElement;
    expect((conteneur as HTMLElement | null)?.className ?? '').not.toContain(CLASSE_ALERTE_METIER);
  });

  it('une coupure réseau — même pas une `ErreurApi` — reste neutre elle aussi', async () => {
    await cloturerAvecReponse(new TypeError('Failed to fetch'));

    const message = await screen.findByText('Erreur inattendue, sans plus de détail.');
    const conteneur = message.closest('[role="alert"]') ?? message.parentElement;
    expect((conteneur as HTMLElement | null)?.className ?? '').not.toContain(CLASSE_ALERTE_METIER);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Ce qui part vraiment, et ce qui reste `null`
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Sessions — le corps de la clôture : jamais un zéro à la place d’un inconnu', () => {
  async function cloturerEtLireLeCorps(
    preparer?: (utilisateur: ReturnType<typeof userEvent.setup>) => Promise<void>,
  ): Promise<Record<string, unknown>> {
    const utilisateur = await ouvrirCloture();
    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/sessions/ses-1/cloturer') return RESULTAT_CLOTURE_MINIMAL;
      return routeurBase?.(chemin, options);
    });

    await remplirClotureValide(utilisateur);
    if (preparer !== undefined) await preparer(utilisateur);
    await utilisateur.click(boutonEnregistrer());

    await waitFor(() =>
      expect(appelApi).toHaveBeenCalledWith(
        '/sessions/ses-1/cloturer',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const appel = appelApi.mock.calls.find(([c]) => c === '/sessions/ses-1/cloturer');
    return JSON.parse(String((appel?.[1] as RequestInit).body)) as Record<string, unknown>;
  }

  it('un champ « tickets » laissé VIDE part en `null`, jamais en 0 — 0 serait refusé par le contrat', async () => {
    const corps = await cloturerEtLireLeCorps();
    expect(corps['nbTickets']).toBeNull();
  });

  it('un « tickets » renseigné part tel quel', async () => {
    const corps = await cloturerEtLireLeCorps(async (utilisateur) => {
      await utilisateur.type(screen.getByLabelText('Tickets (optionnel)'), '87');
    });
    expect(corps['nbTickets']).toBe(87);
  });

  it('aucun relevé de température saisi : la clé `relevesTemperature` est ABSENTE, pas vide', async () => {
    const corps = await cloturerEtLireLeCorps();
    expect(corps).not.toHaveProperty('relevesTemperature');
  });

  it('un relevé complet part avec son moment, son équipement et sa température', async () => {
    const corps = await cloturerEtLireLeCorps(async (utilisateur) => {
      await utilisateur.type(screen.getByLabelText(/^Température °C à l’arrivée/), '4');
    });
    expect(corps['relevesTemperature']).toEqual([
      {
        moment: 'arrivee',
        equipement: 'Glacière rigide',
        temperatureC: 4,
        actionCorrective: null,
      },
    ]);
  });

  it('une température NÉGATIVE avec virgule belge est lue correctement', async () => {
    const corps = await cloturerEtLireLeCorps(async (utilisateur) => {
      await utilisateur.type(screen.getByLabelText(/^Température °C au retour/), '-2,5');
    });
    expect(corps['relevesTemperature']).toEqual([
      expect.objectContaining({ moment: 'retour', temperatureC: -2.5 }),
    ]);
  });

  it('les notes vides partent en `null`, jamais en chaîne vide', async () => {
    const corps = await cloturerEtLireLeCorps();
    expect(corps['notesQualitatives']).toBeNull();
    expect(corps['motifExclusion']).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Inconnu ≠ zéro, à l'écran cette fois
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Sessions — un écart de caisse inconnu s’affiche « — », jamais « −50,00 € »', () => {
  it(
    'sur un formulaire vierge (rien encore compté), l’écart de caisse reste un TIRET — un ' +
      'formulaire neuf affichait sinon un écart de −50,00 € avant la moindre frappe',
    async () => {
      await ouvrirCloture();

      const bloc = screen.getByText('Écart de caisse').closest('p');
      expect(bloc).not.toBeNull();
      expect((bloc as HTMLElement).textContent).toContain('—');
    },
  );

  it('dès que les DEUX comptages existent, l’écart devient un chiffre', async () => {
    const utilisateur = await ouvrirCloture();

    await utilisateur.type(screen.getByLabelText('Espèces comptées (€)'), '50,00');
    await utilisateur.type(screen.getByLabelText('SumUp — carte (€)'), '0,00');

    const bloc = screen.getByText('Écart de caisse').closest('p');
    expect((bloc as HTMLElement).textContent).not.toContain('—');
  });

  it('le taux d’écoulement reste un TIRET tant que rien n’a été produit', async () => {
    await ouvrirCloture();

    const bloc = screen.getByText("Taux d'écoulement").closest('p');
    expect((bloc as HTMLElement).textContent).toContain('—');
  });

  it('un écart de cohérence produites ≠ vendues + invendues + cassées est SIGNALÉ, sans bloquer', async () => {
    const utilisateur = await ouvrirCloture();
    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/sessions/ses-1/cloturer') return RESULTAT_CLOTURE_MINIMAL;
      return routeurBase?.(chemin, options);
    });

    await remplirClotureValide(utilisateur);
    expect(screen.getByText(/Écart de cohérence/)).toBeInTheDocument();

    // NON BLOQUANT : la clôture passe quand même.
    await utilisateur.click(boutonEnregistrer());
    await waitFor(() =>
      expect(appelApi).toHaveBeenCalledWith(
        '/sessions/ses-1/cloturer',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Le frais d'emplacement : un tarif INCONNU n'est pas un emplacement GRATUIT
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ═══ Ce que le porteur lisait, et pourquoi c'était le plus coûteux ═══
 *
 * `initialiserFormulaireEdition` pré-remplissait « Emplacement (€) » avec
 * `defautsLieu?.tarifEmplacementCents ?? 0`, donc « 0,00 » dès qu'aucun tarif
 * n'était connu. Mesuré le 01/08/2026 : l'unique lieu du porteur n'a PAS de
 * tarif enregistré, et l'ouverture d'une session DÉJÀ créée
 * (`ouvrirEditionExistante`) passe de toute façon `null` en défauts de lieu —
 * 100 % des clôtures partaient donc avec ce champ à zéro. La clôture se fait
 * au clavier, en tabulation rapide : un champ pré-rempli se valide sans être
 * lu, et « 0,00 » se relit ensuite « emplacement gratuit ».
 *
 * Le montant remonte aux frais de session, puis au résultat net, puis au
 * compteur du seuil INASTI de 17 374,08 € (CLAUDE.md §6).
 *
 * ═══ Ce que ces tests ne peuvent PAS prouver ═══
 *
 * Que la base garde la distinction. `session_marche.frais_emplacement_cents`
 * est `NOT NULL DEFAULT 0` : une fois la clôture enregistrée, « gratuit » et
 * « inconnu » sont le même 0. Le seul endroit où la distinction existe encore
 * est l'écran, avant le clic — c'est exactement ce que ces tests couvrent, et
 * rien de plus.
 */
describe('Sessions — le frais d’emplacement : « 0,00 » n’est plus le défaut', () => {
  it(
    'aucun tarif connu : le champ « Emplacement » est VIDE, jamais « 0,00 » — même geste que ' +
      'les kilomètres réels',
    async () => {
      await ouvrirCloture();

      const emplacement = screen.getByLabelText(/^Emplacement/);
      expect(emplacement).toHaveValue('');
      // Comparé via le FORMATEUR du projet, jamais via un littéral tapé à la
      // main : `formaterMontant` passe par `Intl`.
      expect(emplacement).not.toHaveValue(formaterMontant(0));
    },
  );

  it(
    'un montant DÉJÀ porté par la session est bien repris — sans ce voisin, un champ toujours ' +
      'vide rendrait le test précédent vert sans rien discriminer',
    async () => {
      await ouvrirCloture({ detail: detailSession({ fraisEmplacementCents: 1_500 }) });

      expect(screen.getByLabelText(/^Emplacement/)).toHaveValue(formaterMontant(1_500));
    },
  );

  it(
    'à la CRÉATION sur un lieu dont le tarif est connu, le champ est pré-rempli avec ce tarif — ' +
      'la commodité n’a pas disparu',
    async () => {
      await creerSessionSurLieu(LIEU_BATTE);

      expect(screen.getByLabelText(/^Emplacement/)).toHaveValue(formaterMontant(1_500));
      // Le lieu porte aussi ses horaires : on vérifie qu'on est bien passé par
      // la branche « défauts de lieu », et pas par un hasard d'état initial.
      expect(screen.getByLabelText('Heure de départ')).toHaveValue('08:00');
    },
  );

  it(
    'à la CRÉATION sur un lieu SANS tarif enregistré, le champ reste VIDE — c’est le cas réel ' +
      'du porteur',
    async () => {
      await creerSessionSurLieu(LIEU_SANS_TARIF);

      expect(screen.getByLabelText(/^Emplacement/)).toHaveValue('');
      // Les horaires, eux, SONT connus pour ce lieu : le formulaire a bien lu
      // les défauts du lieu. Sans cette assertion, un champ vide pourrait
      // seulement signifier « la branche des défauts n'a pas été prise ».
      expect(screen.getByLabelText('Heure de départ')).toHaveValue('08:00');
    },
  );

  it('le champ porte une explication, et elle lui est RATTACHÉE (aria-describedby)', async () => {
    await ouvrirCloture();

    const emplacement = screen.getByLabelText(/^Emplacement/);
    const idAide = emplacement.getAttribute('aria-describedby');
    expect(idAide).not.toBeNull();
    const aide = document.getElementById(idAide as string);
    expect(aide).not.toBeNull();
    // Ce que le porteur doit savoir avant de tabuler : un champ laissé vide
    // finit à 0,00 € en base, et n'y sera plus distinguable d'un emplacement
    // réellement gratuit. Le montant est comparé via le FORMATEUR du projet —
    // `formaterEuros` passe par `Intl` et insère une espace insécable.
    const texte = (aide?.textContent ?? '').replace(/\s+/g, ' ');
    expect(texte).toContain(
      `Un frais laissé vide est enregistré à ${formaterEuros(0).replace(/\s+/g, ' ')}`,
    );
    expect(texte).toContain('ne se distinguera plus d’un emplacement réellement gratuit');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Clavier — CLAUDE.md §3 règle 10
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Sessions — clavier (CLAUDE.md §3 règle 10)', () => {
  it('Ctrl+S clôture, depuis n’importe où — l’écouteur est posé sur `window`', async () => {
    const utilisateur = await ouvrirCloture();
    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/sessions/ses-1/cloturer') return RESULTAT_CLOTURE_MINIMAL;
      return routeurBase?.(chemin, options);
    });

    await remplirClotureValide(utilisateur);
    document.body.focus();
    await utilisateur.keyboard('{Control>}s{/Control}');

    await waitFor(() =>
      expect(appelApi).toHaveBeenCalledWith(
        '/sessions/ses-1/cloturer',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it(
    'après un refus du serveur, le focus REVIENT sur « Enregistrer » (D-079) — le bouton perd ' +
      '`disabled` en fin d’appel, et sans ce rappel le focus retombe sur `<body>`',
    async () => {
      const utilisateur = await ouvrirCloture();
      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/sessions/ses-1/cloturer')
          throw new ErreurApi('Erreur inattendue du serveur.', { code: 'interne', statut: 500 });
        return routeurBase?.(chemin, options);
      });

      await remplirClotureValide(utilisateur);
      // Déclenché au CLAVIER depuis un champ : le focus doit ARRIVER sur le
      // bouton, pas simplement y rester (voir Ingredients.montage.test.tsx).
      screen.getByLabelText('Cassées').focus();
      await utilisateur.keyboard('{Control>}s{/Control}');

      await screen.findByText('Erreur inattendue du serveur.');
      await waitFor(() => expect(boutonEnregistrer()).toHaveFocus());
      expect(document.body).not.toHaveFocus();
    },
  );

  /**
   * ═══ DÉFAUT RÉEL n°4, CORRIGÉ le 01/08/2026 (convention `it.fails`) ═══
   *
   * APRÈS UNE CLÔTURE RÉUSSIE, LE FOCUS TOMBAIT SUR `<body>`.
   *
   * `cloturerSession()` se terminait par
   * `requestAnimationFrame(() => boutonEnregistrerClotureRef.current?.focus())`
   * — la reprise D-079, posée exactement pour éviter ça. Mais la ligne juste
   * au-dessus, `setEtatEdition({ statut: 'pret', detail: resultat })`, repose le
   * détail avec `statut: 'cloturee'`. Or TOUT le formulaire de clôture — bouton
   * « Enregistrer » compris — vit sous `editionEstOuverte`, qui vaut
   * `detailEdition.statut === 'planifiee'`.
   *
   * Le bouton était donc DÉMONTÉ au rendu suivant, `boutonEnregistrerClotureRef.current`
   * valait `null`, et `?.focus()` ne faisait rien : la reprise visait une cible
   * que le même geste venait de détruire. Le `<input>` qui avait le focus
   * disparaissait lui aussi, et le focus retombait sur `<body>`.
   *
   * C'était le troisième défaut de cette même famille trouvé ce jour-là — après
   * la confirmation du réalisé (`Production.tsx`) et celle de l'annulation de
   * session — et le plus coûteux : il frappait l'écriture la plus importante du
   * produit, celle qui clôt une journée de marché. Un utilisateur au clavier
   * devait retraverser toute la navigation pour revenir à l'écran.
   *
   * POURQUOI CE TEST ÉTAIT VERT AVANT (avant même le `it.fails`) :
   * `RESULTAT_CLOTURE_MINIMAL` portait `coutTotalCents` au lieu de
   * `coutTotalReelCents`. `schemaResultatCloture.parse` échouait, la clôture
   * partait dans le `catch` — où le formulaire SURVIT et où une SECONDE reprise
   * de focus existe. Le test mesurait donc le chemin d'erreur en croyant
   * mesurer celui du succès. C'est la mutation S16 (suppression de la reprise
   * du chemin de SUCCÈS) qui l'a révélé : elle restait verte, faute de jamais
   * passer par là.
   *
   * CORRECTIF (`Sessions.tsx`) : le paragraphe « Session du … » est sorti des
   * deux blocs mutuellement exclusifs (`editionEstOuverte` / non) vers un
   * en-tête commun, si bien qu'il reste peint pendant toute la transition. La
   * reprise de focus vise désormais `boutonFermerClotureRef` — le bouton
   * « Fermer » de la vue « Clôture enregistrée » qui remplace le formulaire —
   * au lieu de `boutonEnregistrerClotureRef`, qui pointait vers un nœud sur le
   * point d'être démonté.
   */
  it('après une clôture RÉUSSIE, le focus revient sur un contrôle, pas sur `<body>`', async () => {
    const utilisateur = await ouvrirCloture();
    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/sessions/ses-1/cloturer') return RESULTAT_CLOTURE_MINIMAL;
      return routeurBase?.(chemin, options);
    });

    await remplirClotureValide(utilisateur);
    screen.getByLabelText('Cassées').focus();
    await utilisateur.keyboard('{Control>}s{/Control}');

    await screen.findByText(/^Session du /);
    expect(document.body).not.toHaveFocus();
  });

  it(
    'mesure du mécanisme : la clôture réussit, le formulaire disparaît AVEC son bouton, et le ' +
      'focus revient sur « Fermer » — le seul contrôle qui lui survit',
    async () => {
      const utilisateur = await ouvrirCloture();
      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/sessions/ses-1/cloturer') return RESULTAT_CLOTURE_MINIMAL;
        return routeurBase?.(chemin, options);
      });

      await remplirClotureValide(utilisateur);
      screen.getByLabelText('Cassées').focus();
      await utilisateur.keyboard('{Control>}s{/Control}');

      // La session est bien passée en lecture : plus aucun champ de clôture.
      await waitFor(() =>
        expect(screen.queryByLabelText('Espèces comptées (€)')).not.toBeInTheDocument(),
      );
      // …et le bouton que la reprise D-079 visait n'existe plus : c'est bien
      // ce démontage qui obligeait à retargeter la reprise de focus ailleurs.
      expect(screen.queryByRole('button', { name: /^Enregistrer/ })).not.toBeInTheDocument();
      // Corrigé le 01/08/2026 : ce n'est plus `<body>` qui hérite, mais le
      // bouton « Fermer » de la vue « Clôture enregistrée » qui remplace le
      // formulaire — la seule cible qui existe encore à cet instant.
      expect(screen.getByRole('button', { name: 'Fermer' })).toHaveFocus();
      expect(document.body).not.toHaveFocus();
    },
  );

  it('`Entrée` dans la grille de ventes descend d’une ligne, en en créant une si besoin', async () => {
    const utilisateur = await ouvrirCloture();

    const quantite = screen.getByRole('textbox', { name: 'Quantité vendue — Crêpe sucre' });
    quantite.focus();
    await utilisateur.keyboard('{Enter}');

    // Une ligne libre a été ajoutée, et son champ Quantité a le focus.
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Quantité (ligne libre)' })).toHaveFocus(),
    );
  });

  it('ouvrir « Nouvelle session » place le focus sur le champ Lieu, sans traverser le tableau des seuils', async () => {
    const utilisateur = userEvent.setup();
    routerLectures();
    monter();
    await screen.findByText('02/08/2026');

    await utilisateur.click(screen.getByRole('button', { name: 'Nouvelle session' }));

    await waitFor(() => expect(screen.getByLabelText('Lieu de marché')).toHaveFocus());
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Lecture seule et annulation d'une session close
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Sessions — une session close s’ouvre en LECTURE, jamais en formulaire', () => {
  const SESSION_CLOSE: SessionResume = {
    ...SESSION_PLANIFIEE,
    id: 'ses-close',
    numero: 'SM-2026-0001',
    dateSession: '2026-07-26',
    statut: 'cloturee',
    caTotalCents: 83_800,
    margeNetteCents: 61_200,
    tauxEcoulementBp: 8_900,
    ecartCaisseCents: 0,
    crepesVendues: 134,
  };

  async function ouvrirLectureSeule(): Promise<ReturnType<typeof userEvent.setup>> {
    const utilisateur = userEvent.setup();
    routerLectures({
      sessions: [SESSION_CLOSE],
      detail: detailSession({ ...SESSION_CLOSE, dateCloture: '2026-07-26T18:00:00.000Z' }),
    });
    monter();
    await utilisateur.click(await screen.findByText('26/07/2026'));
    await screen.findByRole('button', { name: 'Fermer' });
    return utilisateur;
  }

  it('n’affiche AUCUN champ de clôture', async () => {
    await ouvrirLectureSeule();

    expect(screen.queryByLabelText('Espèces comptées (€)')).not.toBeInTheDocument();
    expect(screen.getByText('Détail de la session')).toBeInTheDocument();
  });

  it('« Annuler cette session » révèle un champ de motif, et lui donne le focus', async () => {
    const utilisateur = await ouvrirLectureSeule();

    await utilisateur.click(screen.getByRole('button', { name: 'Annuler cette session' }));

    await waitFor(() => expect(screen.getByLabelText("Motif de l'annulation")).toHaveFocus());
  });

  it('une annulation SANS motif est refusée avant tout appel', async () => {
    const utilisateur = await ouvrirLectureSeule();

    await utilisateur.click(screen.getByRole('button', { name: 'Annuler cette session' }));
    appelApi.mockClear();
    await utilisateur.click(screen.getByRole('button', { name: "Confirmer l'annulation" }));

    expect(screen.getByText('Indiquez pourquoi cette session est annulée.')).toBeInTheDocument();
    expect(appelApi).not.toHaveBeenCalledWith('/sessions/ses-close/annuler', expect.anything());
  });

  it('un motif fait d’ESPACES seules est refusé comme un motif vide', async () => {
    const utilisateur = await ouvrirLectureSeule();

    await utilisateur.click(screen.getByRole('button', { name: 'Annuler cette session' }));
    await utilisateur.type(screen.getByLabelText("Motif de l'annulation"), '   ');
    appelApi.mockClear();
    await utilisateur.click(screen.getByRole('button', { name: "Confirmer l'annulation" }));

    expect(screen.getByText('Indiquez pourquoi cette session est annulée.')).toBeInTheDocument();
    expect(appelApi).not.toHaveBeenCalledWith('/sessions/ses-close/annuler', expect.anything());
  });

  /** Prépare l'annulation réussie, et rend l'utilisateur. */
  async function annulerAvecMotif(): Promise<ReturnType<typeof userEvent.setup>> {
    const utilisateur = await ouvrirLectureSeule();

    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/sessions/ses-close/annuler')
        return detailSession({ ...SESSION_CLOSE, statut: 'annulee' });
      return routeurBase?.(chemin, options);
    });

    await utilisateur.click(screen.getByRole('button', { name: 'Annuler cette session' }));
    await utilisateur.type(screen.getByLabelText("Motif de l'annulation"), '  Marché annulé  ');
    await utilisateur.click(screen.getByRole('button', { name: "Confirmer l'annulation" }));
    await waitFor(() =>
      expect(appelApi).toHaveBeenCalledWith('/sessions/ses-close/annuler', expect.anything()),
    );
    return utilisateur;
  }

  it(
    'après une annulation réussie, le focus va sur « Fermer » — le formulaire qui portait le ' +
      'bouton vient d’être démonté, et le bloc entier disparaît avec le statut « annulee »',
    async () => {
      await annulerAvecMotif();

      await waitFor(() => expect(screen.getByRole('button', { name: 'Fermer' })).toHaveFocus());
      expect(document.body).not.toHaveFocus();
    },
  );

  it('une annulation motivée part avec son motif ÉLAGUÉ — jamais les espaces de saisie', async () => {
    await annulerAvecMotif();

    const appel = appelApi.mock.calls.find(([c]) => c === '/sessions/ses-close/annuler');
    expect(JSON.parse(String((appel?.[1] as RequestInit).body))).toEqual({
      motif: 'Marché annulé',
    });
  });

  /**
   * ═══ DÉFAUT RÉEL n°3, CORRIGÉ le 01/08/2026 (convention `it.fails`) ═══
   *
   * La confirmation « Session annulée. » N'ÉTAIT JAMAIS VISIBLE, exactement
   * pour la même raison que celle de la saisie du réalisé dans `Production.tsx`
   * (voir `Production.montage.test.tsx`) : le `<p role="status">` qui la rend
   * vivait À L'INTÉRIEUR du formulaire d'annulation, et `annulerSession()` pose
   * `setRevelerAnnulation(false)` dans la même passe que
   * `setEtatAnnulation({ statut: 'succes', … })`. Le formulaire se démontait
   * donc au rendu qui aurait dû afficher le message.
   *
   * Le second verrou était structurel : la réponse fait passer la session en
   * `annulee`, or tout le bloc n'existe que sous
   * `detail.statut === 'cloturee'`. Même en gardant `revelerAnnulation` à
   * vrai, le message aurait disparu avec son bloc.
   *
   * L'effet de temporisation à 5 s (`setEtatAnnulation({ statut: 'inactif' })`)
   * était mort-né pour la même raison — il redevient vivant maintenant que le
   * paragraphe qu'il éteint peut réellement s'afficher.
   *
   * Correctif (`Sessions.tsx`) : le `<p role="status">` est sorti des deux
   * blocs conditionnels qui le démontaient — il ne dépend plus que
   * d'`etatAnnulation`, jamais de `revelerAnnulation` ni du statut de la
   * session, et vit désormais juste avant `<BlocDetailSession>`, visible tant
   * que le panneau de détail lui-même reste affiché.
   *
   * Conséquence AVANT correctif : après l'annulation d'une pièce comptable —
   * un geste qui touche les compteurs de seuils légaux (CLAUDE.md §6) — le
   * porteur ne recevait AUCUN accusé de réception. Le seul signal était la
   * disparition du bouton.
   */
  it('la confirmation « Session annulée. » est visible', async () => {
    await annulerAvecMotif();
    expect(await screen.findByText('Session annulée.')).toBeInTheDocument();
  });

  it(
    'mesure du mécanisme : l’écriture PART, la fiche se met à jour en « Annulée », et le bloc ' +
      'd’annulation disparaît — c’est le seul signal reçu',
    async () => {
      await annulerAvecMotif();

      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Annuler cette session' }),
        ).not.toBeInTheDocument(),
      );
      expect(screen.queryByLabelText("Motif de l'annulation")).not.toBeInTheDocument();
    },
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   L'ATTENTE PENDANT UN ENVOI — promesse CONTRÔLÉE (docs/39 §3, forme 5)

   Chaque test au-dessus feint le réseau avec `mockResolvedValue` ou un
   `mockImplementation(async …)` : la promesse est déjà résolue au moment où
   le test l'observe, et l'état « en_cours » retombe à « inactif » dans le
   MÊME écoulement de micro-tâches que sa pose — il n'atteint jamais le DOM.
   Mesuré le 02/08/2026 sur ce dépôt : neutraliser la pose de ces états en
   production n'a fait rougir AUCUN des tests ci-dessus.

   Les trois blocs suivants résolvent la promesse EUX-MÊMES, après avoir
   observé l'attente : c'est la seule façon de voir un bouton réellement
   inerte, un libellé d'attente réellement affiché, et — pour la clôture,
   seul emplacement de cet écran qui offre un geste clavier contournant le
   bouton — un garde-fou réellement exercé.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Sessions — l’attente pendant un envoi (promesse contrôlée)', () => {
  it('la création d’une session annonce l’envoi et redevient actionnable après la réponse', async () => {
    const utilisateur = userEvent.setup();
    routerLectures();
    monter();
    await utilisateur.click(await screen.findByRole('button', { name: 'Nouvelle session' }));

    let repondre: ((valeur: unknown) => void) | undefined;
    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/sessions' && options?.method === 'POST') {
        return new Promise((resoudre) => {
          repondre = resoudre;
        });
      }
      return routeurBase?.(chemin, options);
    });

    await utilisateur.click(screen.getByRole('button', { name: 'Créer et ouvrir' }));

    const bouton = await screen.findByRole('button', { name: 'Création…' });
    expect(bouton).toBeDisabled();

    /*
      AUCUN chemin ne contourne ce bouton, et ce n'est pas une supposition :
      le `<form>` « Nouvelle session » le dit lui-même (`Sessions.tsx`) —
      l'écouteur `Ctrl+S` de la clôture sort TANT QUE `sessionEnEditionId` est
      nul, c'est-à-dire exactement pendant la création. Un `<button
      disabled>` bloque en plus nativement le clic ET la soumission implicite
      par Entrée (même limite, mesurée, que `SaisieSortie.montage.test.tsx`).
      Un second geste ici ne prouverait donc RIEN du garde-fou `if
      (etatCreation.statut === 'en_cours') return;` : seul l'attribut
      `disabled` serait mesuré, jamais lui.
    */
    // Une création RÉUSSIE ne fait pas réapparaître « Créer et ouvrir » : le
    // formulaire de création se ferme et laisse place directement au
    // formulaire de CLÔTURE de la session qui vient de naître (même signal
    // de succès que `creerSessionSurLieu` plus haut dans ce fichier) — c'est
    // la vraie transition « redevenu actionnable » de ce geste-ci.
    repondre?.(detailSession({ id: 'ses-neuve', numero: 'SM-2026-0009' }));
    await screen.findByLabelText('Espèces comptées (€)');
  });

  it(
    'la clôture annonce l’envoi ET refuse un second départ par Ctrl+S — le seul geste de cet ' +
      'écran qui contourne un bouton `disabled`',
    async () => {
      const utilisateur = await ouvrirCloture();
      await remplirClotureValide(utilisateur);

      let repondre: ((valeur: unknown) => void) | undefined;
      const routeurBase = appelApi.getMockImplementation();
      appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
        if (chemin === '/sessions/ses-1/cloturer') {
          return new Promise((resoudre) => {
            repondre = resoudre;
          });
        }
        return routeurBase?.(chemin, options);
      });

      await utilisateur.click(boutonEnregistrer());

      // 1. L'attente est ANNONCÉE : le libellé change, et le bouton se
      //    désactive nativement — c'est cet écran qui choisit `disabled`
      //    ici, pas `aria-disabled` (voir `Ingredients.tsx` pour l'autre cas).
      //    Nom accessible RÉEL du bouton : « Enregistrement…Ctrl+S » — le
      //    raccourci clavier vit dans un `<span>` collé au libellé, sans
      //    espace ; un motif ancré (`^`) plutôt qu'exact, même convention que
      //    `boutonEnregistrer` plus haut dans ce fichier.
      const bouton = await screen.findByRole('button', { name: /^Enregistrement…/ });
      expect(bouton).toBeDisabled();

      /*
        2. `Ctrl+S` appelle `cloturerSessionRef.current()` DIRECTEMENT sur
        `window` (`Sessions.tsx`) : il court-circuite le `<button disabled>`,
        exactement le chemin qui rend l'assertion suivante significative — un
        second CLIC ou un `{Enter}` seraient déjà bloqués par le navigateur
        et ne prouveraient rien du garde-fou `if (etatCloture === 'en_cours')
        return;`. La requête reste UNIQUE en vol : c'est ce garde-fou-là, et
        lui seul, que Ctrl+S met à l'épreuve ici.
      */
      await utilisateur.keyboard('{Control>}s{/Control}');
      expect(
        appelApi.mock.calls.filter(([chemin]) => chemin === '/sessions/ses-1/cloturer'),
      ).toHaveLength(1);

      // 3. Une fois la réponse reçue, l'écran redevient actionnable.
      repondre?.(RESULTAT_CLOTURE_MINIMAL);
      await screen.findByText(/^Session du /);
    },
  );

  it('l’annulation d’une session annonce l’envoi et redevient actionnable après la réponse', async () => {
    const utilisateur = userEvent.setup();
    const SESSION_A_ANNULER: SessionResume = {
      ...SESSION_PLANIFIEE,
      id: 'ses-close',
      numero: 'SM-2026-0001',
      dateSession: '2026-07-26',
      statut: 'cloturee',
    };
    routerLectures({
      sessions: [SESSION_A_ANNULER],
      detail: detailSession({ ...SESSION_A_ANNULER, dateCloture: '2026-07-26T18:00:00.000Z' }),
    });
    monter();
    await utilisateur.click(await screen.findByText('26/07/2026'));
    await screen.findByRole('button', { name: 'Fermer' });
    await utilisateur.click(screen.getByRole('button', { name: 'Annuler cette session' }));
    await utilisateur.type(screen.getByLabelText("Motif de l'annulation"), 'Marché annulé');

    let repondre: ((valeur: unknown) => void) | undefined;
    const routeurBase = appelApi.getMockImplementation();
    appelApi.mockImplementation(async (chemin: string, options?: RequestInit) => {
      if (chemin === '/sessions/ses-close/annuler') {
        return new Promise((resoudre) => {
          repondre = resoudre;
        });
      }
      return routeurBase?.(chemin, options);
    });

    await utilisateur.click(screen.getByRole('button', { name: "Confirmer l'annulation" }));

    const bouton = await screen.findByRole('button', { name: 'Annulation…' });
    expect(bouton).toBeDisabled();

    // Même limite que pour la création : ce formulaire n'a aucun écouteur
    // clavier global, seul `disabled` protège ici — pas de second chemin à
    // mettre à l'épreuve, et ce test ne prétend pas le contraire.
    repondre?.(detailSession({ ...SESSION_A_ANNULER, statut: 'annulee' }));
    await screen.findByText('Session annulée.');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   `AnalyseEcartClaude` — défaut réel trouvé en LECTURE de `Sessions.tsx`

   Hors zone d'écriture de cette mission (aucun fichier `.tsx` de production) :
   convention `it.fails` de docs/39-DOCTRINE-DES-AGENTS.md §8.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Sessions — `AnalyseEcartClaude` : défaut de focus trouvé en lecture', () => {
  /**
   * ═══ DÉFAUT RÉEL, NON CORRIGÉ ═══
   *
   * Le bouton « Demander une analyse » n'est rendu que sous `{etat.statut
   * === 'inactif' && …}` (`Sessions.tsx`, fonction `AnalyseEcartClaude`). Au
   * clic, `demander()` pose `setEtat({ statut: 'en_cours' })` AVANT tout
   * `await` : ce bloc — bouton compris — se démonte donc au rendu suivant,
   * remplacé par `<p>Claude réfléchit…</p>`, qui ne porte ni rôle
   * focalisable ni `tabIndex`. Le nœud qui avait le focus est RETIRÉ DU DOM,
   * et le focus retombe sur `<body>` : le défaut exact de CLAUDE.md §3
   * règle 10, la même famille que `boutonEnregistrerClotureRef` et
   * `boutonFermerLectureSeuleRef` plus haut dans ce fichier — sauf qu'ici
   * aucune reprise (`requestAnimationFrame(() => …focus())`) n'existe pour
   * la rattraper.
   *
   * CONSÉQUENCE SUR `aria-disabled` : `const inerte = etat.statut ===
   * 'en_cours' || raisonIndisponible !== undefined` porte un premier terme
   * STRUCTURELLEMENT INATTEIGNABLE — le bouton qui le lit n'est jamais rendu
   * au moment où ce terme serait vrai. Le code se lit comme un garde-fou
   * d'attente ; il ne peut jamais s'exercer comme tel. Aucun double-envoi
   * n'en résulte pour autant (aucun second clic n'est possible sur un bouton
   * absent du DOM) : c'est la PERTE DE FOCUS, mesurée ci-dessous, qui est le
   * défaut réel et démontrable.
   *
   * Cette classe de défaut — un contrôle démonté par le bloc conditionnel
   * qui l'entoure — a déjà été identifiée et corrigée trois fois le
   * 01/08/2026 ailleurs dans ce dépôt en sortant le bouton concerné des
   * blocs qui le démontaient (voir le commentaire du bouton « Retirer ce
   * format d'achat », `Ingredients.montage.test.tsx`). Le remède appartient
   * à `Sessions.tsx`, hors de la zone d'écriture de cette mission : voir le
   * rapport de livraison.
   */
  it.fails(
    'DÉFAUT CONNU — cliquer « Demander une analyse » perd le focus au profit de `<body>`',
    async () => {
      const utilisateur = userEvent.setup();
      const SESSION_CLOTUREE: SessionResume = {
        ...SESSION_PLANIFIEE,
        id: 'ses-close',
        numero: 'SM-2026-0001',
        dateSession: '2026-07-26',
        statut: 'cloturee',
      };
      routerLectures({
        sessions: [SESSION_CLOTUREE],
        detail: detailSession({ ...SESSION_CLOTUREE, dateCloture: '2026-07-26T18:00:00.000Z' }),
      });
      monter();
      await utilisateur.click(await screen.findByText('26/07/2026'));
      await screen.findByRole('button', { name: 'Fermer' });

      // Requête qui ne répond JAMAIS : ce test ne mesure QUE la transition de
      // rendu déclenchée par `setEtat({ statut: 'en_cours' })`, pas ce qui
      // suivrait une réponse.
      appelApi.mockImplementation(() => new Promise(() => {}));

      const bouton = screen.getByRole('button', { name: 'Demander une analyse' });
      bouton.focus();
      expect(bouton).toHaveFocus();
      await utilisateur.click(bouton);

      // CE QUE CE TEST ATTEND, et qui échoue aujourd'hui : un contrôle
      // focalisable garde la main pendant l'attente, comme partout ailleurs
      // dans ce fichier (Ctrl+S sur « Enregistrer », l'annulation de session).
      expect(document.body).not.toHaveFocus();
    },
  );
});
