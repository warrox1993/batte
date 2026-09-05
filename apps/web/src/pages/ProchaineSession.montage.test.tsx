/**
 * Écran PROCHAINE SESSION, MONTÉ pour de vrai (jsdom, D-095 du 01/08/2026).
 *
 * ═══ Ce que `ProchaineSession.test.tsx`, à côté, ne POUVAIT pas voir ═══
 *
 * Le fichier voisin teste `formaterFacteur`, `libelleEvenementsPrevision`,
 * `etatDepuisErreurPrevision`, `cheminComparateurDuLieu` et
 * `formaterCoutAppelIa` — fonctions pures, correctement testées, et
 * intouchées ici. Ce qu'aucune d'elles ne peut prouver : que l'écran CHOISIT
 * bien l'encadré informatif plutôt que l'encadré rouge, qu'aucun appel Claude
 * ne part TOUT SEUL, et qu'un double-clic sur « Archiver » n'archive pas deux
 * fois. Ces trois faits n'existent qu'après le premier rendu.
 *
 * ═══ Le garde-fou de dépense (CLAUDE.md §5) est ici, pas ailleurs ═══
 *
 * Deux panneaux de cet écran appellent Claude, et chaque appel coûte de
 * l'argent au porteur. Le contrat est qu'ils ne partent JAMAIS seuls. Rien ne
 * le vérifiait : un `useEffect` ajouté par inadvertance dans l'un des deux
 * aurait facturé un appel à chaque ouverture d'écran sans qu'aucun test ne
 * bronche. Le mock réseau de ce fichier rend cette faute visible — il
 * n'appelle évidemment jamais l'API Anthropic réelle.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TIRET_ABSENT, formaterEuros, formaterPourcent, type Prevision } from '@batte/core';

// Import de TYPE uniquement (effacé à la compilation, donc insensible au
// hissage de `vi.mock`) : la forme `typeof import('...')` en position de
// type est refusée par `@typescript-eslint/consistent-type-imports`.
import type * as ModuleApi from '../lib/api';

vi.mock('../lib/api', async (importerReel) => {
  const reel = await importerReel<typeof ModuleApi>();
  return { ...reel, requeteApi: vi.fn() };
});

const { ErreurApi, requeteApi } = await import('../lib/api');
const { default: ProchaineSession, formaterCoutAppelIa } = await import('./ProchaineSession');

type AppelApi = (chemin: string, options?: RequestInit) => Promise<unknown>;
const appelApi = vi.mocked(requeteApi) as unknown as ReturnType<typeof vi.fn<AppelApi>>;

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Prévision ÉCRÊTÉE par une contrainte : 180 recommandées ramenées à 134 par
 * la capacité de cuisson, avec son manque à gagner chiffré. Une prévision non
 * écrêtée ne prouverait rien sur la ligne d'écrêtage, qui est précisément
 * celle que l'écran doit rendre lisible.
 */
const PREVISION: Prevision = {
  session: {
    id: 'sess-1',
    numero: 'S-2026-031',
    dateSession: '2026-08-02',
    lieuId: 'lieu-batte',
    lieuNom: 'La Batte',
  },
  baseline: {
    baselineCrepes: 128,
    nbSessionsRetenues: 9,
    poidsPriorBp: 1200,
    explication: 'Moyenne pondérée de 9 sessions comparables.',
  },
  meteo: {
    disponible: true,
    conditions: {
      temperatureC: 19.5,
      precipitationsMm: 0.2,
      ventKmh: 14,
      couvertureNuageuseBp: 4500,
    },
    categorie: 'sec_doux',
    facteurBp: 10600,
    ventFort: false,
    explication: 'Temps sec et doux',
    recupereLe: '2026-08-01',
  },
  facteurs: {
    meteoBp: 10600,
    evenementBp: 10000,
    saisonBp: 9800,
    tendanceBp: 10000,
    saisonExplication: 'Saison mesurée sur 24 mois.',
    tendanceExplication: 'Tendance non modélisée (historique trop court).',
  },
  /**
   * Horizon POSITIF dans la fixture nominale (D-098) : c'est le cas six jours
   * sur sept, et c'est celui qui doit rester muet. Le cas `0` est construit
   * explicitement par les deux tests dédiés plus bas — jamais déduit d'une
   * horloge, donc jamais dépendant du jour où ce fichier est relu.
   */
  horizonJours: 6,
  p10: 96,
  p50: 134,
  p90: 187,
  couts: {
    coutRuptureCents: 317,
    coutInvenduCents: 33,
    // Les DEUX drapeaux, portés au contrat le 01/08/2026. Ils disent que les
    // deux montants ci-dessus reposent sur de vraies données ; à `false`, le
    // montant qui les accompagne est un ZÉRO SENTINELLE dont le moteur a
    // besoin pour proposer une quantité, jamais un coût mesuré.
    coutInvenduConnu: true,
    prixMoyenConnu: true,
    origine: 'Coûts issus du catalogue de produits et de la recette R1 v1.',
  },
  quantileCibleBp: 9000,
  crepesRecommandees: 180,
  crepesRetenues: 134,
  contraintes: [
    { libelle: 'Capacité de cuisson', plafondCrepes: 134 },
    { libelle: 'Stock de farine', plafondCrepes: 210 },
  ],
  contrainteLimitante: 'Capacité de cuisson',
  manqueAGagnerCents: 14_582,
  confianceBp: 7200,
  nbSessionsComparables: 9,
  explication: ['Base historique de 128 crêpes.', 'Météo sèche et douce : +6 %.'],
  repartition: [
    { recetteId: 'r-1', code: 'R1', sansGluten: false, partBp: 8000, crepes: 107, volumeMl: 8100 },
    { recetteId: 'r-2', code: 'R2', sansGluten: true, partBp: 2000, crepes: 27, volumeMl: 2000 },
  ],
  repartitionRecettesIndisponible: false,
  plancherSansGlutenApplique: true,
  evenements: [],
};

/* ═══════════════════════════════════════════════════════════════════════════
   Aiguillage
   ═══════════════════════════════════════════════════════════════════════════ */

type Reponses = Record<string, () => Promise<unknown>>;

function brancherApi(reponses: Reponses): void {
  appelApi.mockImplementation((chemin, options) => {
    const cle = `${options?.method ?? 'GET'} ${chemin}`;
    const reponse = reponses[cle];
    if (reponse === undefined) {
      return Promise.reject(
        new Error(`Aucune réponse déclarée pour « ${cle} » — la fixture ne couvre pas cet appel.`),
      );
    }
    return reponse();
  });
}

function reponsesNominales(prevision: Prevision = PREVISION): Reponses {
  return { 'GET /prevision': () => Promise.resolve(prevision) };
}

function monter(): void {
  render(<ProchaineSession />);
}

function normaliser(texte: string): string {
  return texte.replace(/\s+/g, ' ').trim();
}

/** Tous les chemins appelés, méthode comprise — sert à prouver ce qui N'A PAS été appelé. */
function cheminsAppeles(): string[] {
  return appelApi.mock.calls.map(([chemin, options]) => `${options?.method ?? 'GET'} ${chemin}`);
}

beforeEach(() => {
  appelApi.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   Transitions d'état — trois sorties, trois registres
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Prochaine session — chargement, prêt, absences, erreur', () => {
  it('annonce le calcul, puis affiche la décision et son lieu', async () => {
    brancherApi(reponsesNominales());
    monter();

    expect(screen.getByText('Calcul de la prévision…')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: /À produire — La Batte/ }),
    ).toBeInTheDocument();
    // `.text-3xl` : le seul chiffre mis en avant de l'écran (docs/07 — « le
    // nombre de crêpes à produire est le seul `text-3xl` »). « 134 » apparaît
    // aussi comme plafond de la contrainte limitante ; c'est normal, les deux
    // sont le même nombre, et c'est bien pour cela qu'il faut viser.
    expect(screen.getByText('134', { selector: '.text-3xl' })).toBeInTheDocument();
  });

  it('« aucune session planifiée » est un FAIT, pas une erreur : encadré informatif, jamais rouge', async () => {
    brancherApi({
      'GET /prevision': () =>
        Promise.reject(
          new ErreurApi('Aucune session n’est planifiée à venir.', {
            code: 'aucune_session_planifiee',
            statut: 404,
          }),
        ),
    });
    monter();

    expect(await screen.findByText('Aucune session à venir')).toBeInTheDocument();
    expect(screen.getByText('Aucune session n’est planifiée à venir.')).toBeInTheDocument();
    // Rien à archiver, aucune météo à rafraîchir : les actions disparaissent.
    expect(
      screen.queryByRole('button', { name: 'Archiver cette prévision' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rafraîchir la météo' })).not.toBeInTheDocument();
  });

  it('un PREMIER PASSAGE sur le lieu (D-082) le dit sans rien inventer, et sans registre d’erreur', async () => {
    brancherApi({
      'GET /prevision': () =>
        Promise.reject(
          new ErreurApi(
            'Aucune session close sur ce lieu : aucune prévision ne peut être calculée.',
            { code: 'premier_passage_lieu', statut: 422 },
          ),
        ),
    });
    monter();

    expect(
      await screen.findByText('Premier passage : aucune prévision possible'),
    ).toBeInTheDocument();
    // Aucun chiffre de production n'est proposé — c'est tout le point de D-082.
    expect(screen.queryByRole('heading', { name: /À produire/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Archiver cette prévision' }),
    ).not.toBeInTheDocument();
  });

  it('une VRAIE erreur, elle, reste dans le registre d’erreur', async () => {
    brancherApi({
      'GET /prevision': () =>
        Promise.reject(
          new ErreurApi('Le paramètre « quantile_cible_bp » n’est pas défini.', {
            code: 'parametre_absent',
            statut: 500,
          }),
        ),
    });
    monter();

    const message = await screen.findByText(/quantile_cible_bp/);
    expect(message.className).toContain('depassement');
    // Et surtout : ce n'est PAS un encadré informatif d'état vide.
    expect(
      screen.queryByText('Premier passage : aucune prévision possible'),
    ).not.toBeInTheDocument();
  });

  it('« Rafraîchir la météo » relance le calcul avec le drapeau explicite, jamais sans', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /prevision?rafraichirMeteo=1': () => Promise.resolve(PREVISION),
    });
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    await userEvent.click(screen.getByRole('button', { name: 'Rafraîchir la météo' }));

    expect(await screen.findByRole('heading', { name: /À produire/ })).toBeInTheDocument();
    expect(cheminsAppeles()).toContain('GET /prevision?rafraichirMeteo=1');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   La décision, et ce qui la borne
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Prochaine session — l’écrêtage et son coût', () => {
  it('dit de combien la production a été RAMENÉE, par quoi, et ce que ça coûte', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    const ligne = screen.getByText(/Ramené de/);
    expect(ligne).toHaveTextContent('180');
    expect(ligne).toHaveTextContent('134');
    expect(ligne).toHaveTextContent('Capacité de cuisson');
    expect(normaliser(ligne.textContent ?? '')).toContain(normaliser(formaterEuros(14_582)));
  });

  it('explique POURQUOI on ne produit pas la médiane — le quantile cible, jamais 50 %', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    const phrase = screen.getByText(/Une rupture coûte/);
    expect(normaliser(phrase.textContent ?? '')).toContain(normaliser(formaterEuros(317)));
    expect(normaliser(phrase.textContent ?? '')).toContain(normaliser(formaterEuros(33)));
    expect(normaliser(phrase.textContent ?? '')).toContain(normaliser(formaterPourcent(9000)));
    expect(phrase).toHaveTextContent('pas 50 %');
    // Le « donc » n'apparaît QUE si les deux coûts sont connus : il affirme
    // que le quantile cible découle de leur écart.
    expect(normaliser(phrase.textContent ?? '')).toContain('On produit donc au niveau');
    // Rien à avertir : les deux coûts reposent sur de vraies données.
    expect(screen.queryByText(/Chiffre inconnu, pas nul/)).not.toBeInTheDocument();
    // L'origine des coûts est dite : « l'utilisateur doit pouvoir contester ».
    expect(screen.getByText(PREVISION.couts.origine)).toBeInTheDocument();
  });

  /**
   * ═══ « Une rupture coûte 0,00 € de marge, un invendu 0,00 € de pâte » ═══
   *
   * Ce que le porteur lisait avant le 01/08/2026, et c'est le pire mensonge
   * possible sur cet écran : il énonce que SURPRODUIRE EST GRATUIT, et il
   * l'énonce comme la CAUSE du volume recommandé juste au-dessus.
   *
   * D'où venait ce zéro : `coutsNewsvendor` (`packages/db`) DOIT rendre deux
   * nombres au moteur même sans aucune donnée (mode dégradé, CLAUDE.md §5). Il
   * rend donc `0` et le signale par `coutInvenduConnu` / `prixMoyenConnu`.
   * Ces deux drapeaux existaient, étaient correctement consommés par
   * `/api/lieux-rentabilite` et `/api/opportunites`… mais n'étaient PAS
   * déclarés dans `schemaPrevision` : Zod les supprimait donc en silence à la
   * frontière HTTP (docs/39 §5), et ils n'existaient nulle part dans
   * `apps/web`.
   *
   * DISCRIMINATION DE LA FIXTURE : le cas nominal ci-dessus porte les deux
   * drapeaux à `true` et affiche deux vrais montants. Une fixture où tout
   * serait inconnu ne prouverait rien (docs/39 §3, troisième forme).
   */
  it(
    'coût matière INCONNU : « — », jamais « 0,00 € » — et la rupture passe au tiret elle aussi, ' +
      'car elle se déduit du même terme',
    async () => {
      brancherApi(
        reponsesNominales({
          ...PREVISION,
          couts: {
            // Le zéro sentinelle EXACT que rendrait `coutsNewsvendor` : aucune
            // production, aucune recette au coût connu.
            coutRuptureCents: 350,
            coutInvenduCents: 0,
            coutInvenduConnu: false,
            prixMoyenConnu: true,
            origine: 'Estimés : coût matière issu des recettes actives.',
          },
        }),
      );
      monter();
      await screen.findByRole('heading', { name: /À produire/ });

      const phrase = normaliser(screen.getByText(/Une rupture coûte/).textContent ?? '');
      expect(phrase).toContain(`un invendu ${TIRET_ABSENT} de pâte`);
      // `coutRuptureCents = max(0, prix − matière)` : une matière inconnue
      // comptée pour 0 gonfle la marge perdue d'autant. 350 est donc à taire.
      expect(phrase).toContain(`Une rupture coûte ${TIRET_ABSENT} de marge`);
      expect(phrase).not.toContain(normaliser(formaterEuros(0)));
      expect(phrase).not.toContain(normaliser(formaterEuros(350)));
      // Le lien de causalité tombe : le quantile n'est plus présenté comme la
      // conséquence d'un écart de coûts qu'on ne connaît pas.
      expect(phrase).not.toContain('donc');
      // Le quantile lui-même reste affiché : il EST celui-là, c'est vrai.
      expect(phrase).toContain(normaliser(formaterPourcent(9000)));
    },
  );

  it('le manque est NOMMÉ, et il nomme ce qui manque vraiment — pas les deux à la fois', async () => {
    brancherApi(
      reponsesNominales({
        ...PREVISION,
        couts: {
          coutRuptureCents: 350,
          coutInvenduCents: 0,
          coutInvenduConnu: false,
          prixMoyenConnu: true,
          origine: 'Estimés : coût matière issu des recettes actives.',
        },
      }),
    );
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    const avertissement = screen.getByText(/Chiffre inconnu, pas nul/);
    expect(avertissement).toHaveTextContent('coût matière');
    // Le prix de vente, lui, EST connu : l'avertissement ne doit pas envoyer
    // ressaisir ce qui est déjà saisi (même défaut que celui corrigé sur
    // `lieux-rentabilite` et `opportunites`).
    expect(avertissement).not.toHaveTextContent('prix de vente moyen');
    expect(avertissement).toHaveTextContent('comme si cette valeur était de zéro');
  });

  it('prix de vente INCONNU : c’est LUI qui est nommé, et le coût matière reste chiffré', async () => {
    brancherApi(
      reponsesNominales({
        ...PREVISION,
        couts: {
          coutRuptureCents: 0,
          coutInvenduCents: 33,
          coutInvenduConnu: true,
          prixMoyenConnu: false,
          origine: 'Estimés : prix moyen issu du tarif affiché.',
        },
      }),
    );
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    const phrase = normaliser(screen.getByText(/Une rupture coûte/).textContent ?? '');
    // La matière EST connue : elle reste chiffrée. Sans ce voisin, un écran
    // tout en tirets ne discriminerait rien.
    expect(phrase).toContain(`un invendu ${normaliser(formaterEuros(33))} de pâte`);
    expect(phrase).toContain(`Une rupture coûte ${TIRET_ABSENT} de marge`);

    const avertissement = screen.getByText(/Chiffre inconnu, pas nul/);
    expect(avertissement).toHaveTextContent('prix de vente moyen');
    expect(avertissement).not.toHaveTextContent('coût matière');
  });

  it('les DEUX inconnus sont nommés dans la même phrase, jamais un seul', async () => {
    brancherApi(
      reponsesNominales({
        ...PREVISION,
        couts: {
          coutRuptureCents: 0,
          coutInvenduCents: 0,
          coutInvenduConnu: false,
          prixMoyenConnu: false,
          origine: 'Estimés : coût matière issu des recettes actives, prix moyen issu du tarif.',
        },
      }),
    );
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    const avertissement = screen.getByText(/Chiffre inconnu, pas nul/);
    expect(avertissement).toHaveTextContent('prix de vente moyen');
    expect(avertissement).toHaveTextContent('coût matière');
  });

  it('un écrêtage à ZÉRO n’accuse PAS la recette : la vraie cause est déjà affichée au-dessus', async () => {
    brancherApi(
      reponsesNominales({
        ...PREVISION,
        crepesRetenues: 0,
        repartition: [],
        repartitionRecettesIndisponible: false,
        contrainteLimitante: 'Stock de farine',
      }),
    );
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    const message = screen.getByText(/Aucune crêpe retenue pour l’instant/);
    expect(message).toHaveTextContent('Stock de farine');
    // Le message qui accuserait à tort le rendement d'une recette.
    expect(message).not.toHaveTextContent('renseignez le rendement');
  });

  it('des recettes réellement indépartageables, elles, le disent — et c’est un autre message', async () => {
    brancherApi(
      reponsesNominales({
        ...PREVISION,
        repartition: [],
        repartitionRecettesIndisponible: true,
      }),
    );
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    expect(
      screen.getByText(/sans historique de production pour les départager/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Aucune crêpe retenue/)).not.toBeInTheDocument();
  });

  it('le plan de production nomme la recette SANS GLUTEN et signale le plancher relevé d’office', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    expect(screen.getByText(/R2 \(sans gluten\)/)).toBeInTheDocument();
    expect(screen.getByText(/Plancher de sécurité sans gluten appliqué/)).toBeInTheDocument();
  });

  it('une météo INDISPONIBLE ne bloque rien : mode dégradé annoncé, prévision toujours affichée', async () => {
    brancherApi(
      reponsesNominales({
        ...PREVISION,
        meteo: { disponible: false, raison: 'Open-Meteo injoignable depuis 2 h.' },
      }),
    );
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    expect(screen.getByText('▲ Météo indisponible.')).toBeInTheDocument();
    expect(screen.getByText(/Open-Meteo injoignable/)).toBeInTheDocument();
    expect(screen.getByText(/Facteur neutre appliqué/)).toBeInTheDocument();
    // La décision reste là : c'est ce que « mode dégradé » veut dire.
    expect(screen.getByText('134', { selector: '.text-3xl' })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   L'intervalle qui se resserre le dimanche matin (D-098)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ═══ Pourquoi ces deux cas, et pourquoi AUCUNE horloge ═══
 *
 * Le piège de ce sujet est documenté en `docs/39-DOCTRINE-DES-AGENTS.md` §3,
 * quatrième forme : un test d'activation de prédicteur écrit un SAMEDI est
 * passé au rouge le DIMANCHE, sans qu'une ligne de code ait bougé — le
 * prochain jour de marché de La Batte rendant le jour même quand on y est
 * déjà, l'horizon valait 0 et le prédicteur d'écart météo refusait.
 *
 * Ces deux tests ne peuvent pas retomber dans ce trou, et pas parce qu'ils
 * figent l'horloge : parce qu'ils N'EN LISENT AUCUNE. `horizonJours` est un
 * fait porté par le contrat (`schemaPrevision`, D-098), calculé serveur ; la
 * fixture le POSE. Le jour où ce fichier est relu n'entre nulle part.
 *
 * DEUX cas, et le second n'est pas décoratif : sans lui, on ne prouverait pas
 * que la phrase DISPARAÎT quand elle n'a plus lieu d'être — un composant qui
 * l'afficherait tous les jours passerait le premier test.
 */
describe('Prochaine session — l’horizon nul se DIT, il ne se devine pas', () => {
  /** Début de la phrase, assez long pour ne pas coïncider avec autre chose. */
  const DEBUT_MENTION = /Le marché a lieu aujourd’hui/;

  it('session CE JOUR MÊME : l’intervalle plus étroit est expliqué, comme un fait et non une alerte', async () => {
    brancherApi(reponsesNominales({ ...PREVISION, horizonJours: 0 }));
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    const mention = screen.getByText(DEBUT_MENTION);

    // Le TROISIÈME cas est nommé : ni mesuré, ni inconnu — sans objet.
    expect(normaliser(mention.textContent ?? '')).toContain('sans objet');
    expect(normaliser(mention.textContent ?? '')).toContain('ni mesuré ni inconnu');
    // Et les deux contresens sont fermés : ce n'est pas une panne…
    expect(normaliser(mention.textContent ?? '')).toContain('n’a simplement pas lieu d’être');
    // …et ce n'est pas un gain de précision.
    expect(normaliser(mention.textContent ?? '')).toContain(
      'pas parce que la prévision serait plus sûre',
    );

    // REGISTRE. `EncartErreur.tsx` distingue l'alerte MÉTIER (glyphe `▲`,
    // `text-alerte` : il y a un geste à faire) de la panne TECHNIQUE
    // (`role="alert"`, ton neutre). Ce fait n'est NI l'un NI l'autre.
    expect(mention).not.toHaveTextContent('▲');
    expect(mention.className).not.toContain('alerte');
    expect(mention.closest('[role="alert"]')).toBeNull();

    // PLACEMENT. La phrase qualifie l'INTERVALLE : elle doit suivre les trois
    // nombres qu'elle explique, pas se perdre dans « D'où vient ce chiffre ».
    // `DOCUMENT_POSITION_FOLLOWING` (4) rougirait si elle était déplacée.
    const fourchetteHaute = screen.getByText('Fourchette haute');
    expect(
      fourchetteHaute.compareDocumentPosition(mention) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    // COHÉRENCE DE LA FIXTURE, pas une preuve sur l'écran : le serveur
    // n'envoie JAMAIS `inflationSigmaMeteoBp` à horizon nul (le prédicteur
    // refuse), donc cette ligne ne peut pas être là. L'état inverse
    // — horizon 0 ET inflation présente — n'existe pas côté serveur, il
    // serait donc malhonnête de le fabriquer ici pour « faire discriminer »
    // le test. C'est l'intégration `previsions-horizon-nul.test.ts` qui prouve
    // que la ligne est présente un mercredi et absente le dimanche.
    expect(screen.queryByText(/Fiabilité météo/)).not.toBeInTheDocument();
  });

  it('session à VENIR : la phrase disparaît — elle ne s’affiche pas « au cas où »', async () => {
    // Même fixture, même montage, seul `horizonJours` change : c'est ce qui
    // prouve que la phrase suit CE fait et rien d'autre.
    brancherApi(reponsesNominales({ ...PREVISION, horizonJours: 6 }));
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    expect(screen.queryByText(DEBUT_MENTION)).not.toBeInTheDocument();
    // L'écran, lui, est bien rendu : l'absence n'est pas celle d'un écran mort.
    expect(screen.getByText('134', { selector: '.text-3xl' })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Le garde-fou de dépense (CLAUDE.md §5)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Prochaine session — Claude ne parle que sur demande', () => {
  it('AUCUN appel Claude ne part au chargement de l’écran — ni l’avis, ni le résumé du brief', async () => {
    brancherApi(reponsesNominales());
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    // Les deux panneaux sont bien montés…
    expect(screen.getByRole('button', { name: 'Demander un avis' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Résumer le brief' })).toBeInTheDocument();
    // …et n'ont RIEN appelé. Un `useEffect` glissé dans l'un des deux
    // facturerait un appel à chaque ouverture de l'écran.
    expect(cheminsAppeles()).not.toContain('POST /prevision/commenter');
    expect(cheminsAppeles()).not.toContain('POST /prevision/brief/commenter');
  });

  it('l’avis demandé affiche son texte ET le coût de CET appel', async () => {
    brancherApi({
      ...reponsesNominales(),
      'POST /prevision/commenter': () =>
        Promise.resolve({
          disponible: true,
          texte: 'La contrainte de cuisson borne la journée : arrivez plus tôt.',
          coutCents: 2,
        }),
    });
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    await userEvent.click(screen.getByRole('button', { name: 'Demander un avis' }));

    expect(await screen.findByText(/arrivez plus tôt/)).toBeInTheDocument();
    // Comparaison NORMALISÉE : `formaterEuros` insère une espace insécable
    // avant le « € », que le DOM lu par la requête rend en espace ordinaire.
    expect(
      screen.getByText(
        (_, element) =>
          normaliser(element?.textContent ?? '') === normaliser(formaterCoutAppelIa(2)),
      ),
    ).toBeInTheDocument();
  });

  it('une IA INDISPONIBLE (plafond, pas de clé) est un état normal, jamais une erreur rouge', async () => {
    brancherApi({
      ...reponsesNominales(),
      'POST /prevision/brief/commenter': () =>
        Promise.resolve({
          disponible: false,
          raison: 'Plafond mensuel atteint : les appels non essentiels sont coupés.',
        }),
    });
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    await userEvent.click(screen.getByRole('button', { name: 'Résumer le brief' }));

    const message = await screen.findByText(/Plafond mensuel atteint/);
    expect(message.className).not.toContain('depassement');
  });

  it('les deux panneaux Claude sont bien DEUX consignes distinctes, appelées séparément', async () => {
    brancherApi({
      ...reponsesNominales(),
      'POST /prevision/commenter': () =>
        Promise.resolve({ disponible: true, texte: 'Avis sur la prévision.', coutCents: 2 }),
      'POST /prevision/brief/commenter': () =>
        Promise.resolve({ disponible: true, texte: 'Résumé du brief.', coutCents: 3 }),
    });
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    await userEvent.click(screen.getByRole('button', { name: 'Demander un avis' }));
    await screen.findByText('Avis sur la prévision.');

    // Le second bouton n'a pas été déclenché par le premier : deux consignes
    // sous un seul bouton empêcheraient de savoir laquelle on paie.
    expect(cheminsAppeles()).not.toContain('POST /prevision/brief/commenter');
    expect(screen.getByRole('button', { name: 'Résumer le brief' })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Archivage — une écriture, jamais deux
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Prochaine session — archivage', () => {
  it('un DOUBLE-CLIC n’archive qu’une seule fois : le verrou synchrone tient', async () => {
    let libere: (() => void) | undefined;
    brancherApi({
      ...reponsesNominales(),
      'POST /prevision/archiver': () =>
        new Promise((resoudre) => {
          libere = () => resoudre({});
        }),
    });
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    const bouton = screen.getByRole('button', { name: 'Archiver cette prévision' });
    await userEvent.click(bouton);
    await userEvent.click(screen.getByRole('button', { name: /Archiver|Archivage/ }));

    // `archivage.statut` seul ne suffirait pas : `setArchivage` est
    // asynchrone, les deux clics verraient `inactif`. Le verrou est une `ref`.
    expect(cheminsAppeles().filter((c) => c === 'POST /prevision/archiver')).toHaveLength(1);
    libere?.();
  });

  it('l’archivage réussi le confirme, et transmet l’identifiant de SESSION, jamais rien d’autre', async () => {
    brancherApi({ ...reponsesNominales(), 'POST /prevision/archiver': () => Promise.resolve({}) });
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    await userEvent.click(screen.getByRole('button', { name: 'Archiver cette prévision' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Prévision archivée');
    const corps = JSON.parse(
      String(appelApi.mock.calls.find(([c]) => c === '/prevision/archiver')?.[1]?.body),
    ) as Record<string, unknown>;
    expect(corps).toEqual({ sessionId: 'sess-1' });
  });

  it('un archivage refusé le dit, et ne prétend jamais avoir réussi', async () => {
    brancherApi({
      ...reponsesNominales(),
      'POST /prevision/archiver': () =>
        Promise.reject(
          new ErreurApi('Une prévision est déjà archivée pour cette session.', {
            code: 'prevision_deja_archivee',
            statut: 409,
          }),
        ),
    });
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    await userEvent.click(screen.getByRole('button', { name: 'Archiver cette prévision' }));

    expect(await screen.findByText(/déjà archivée pour cette session/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('le comparateur de prix concurrents n’appelle le réseau qu’une fois DÉPLIÉ', async () => {
    brancherApi({
      ...reponsesNominales(),
      'GET /concurrents/comparateur?lieuId=lieu-batte': () =>
        Promise.resolve({
          produits: [],
          moyenne: {
            notrePrixMoyenCrepeCents: 350,
            concurrentsPrixMoyenCents: 400,
            ecartBp: -1250,
          },
        }),
    });
    monter();
    await screen.findByRole('heading', { name: /À produire/ });

    expect(cheminsAppeles().some((c) => c.includes('/concurrents/comparateur'))).toBe(false);
  });
});
