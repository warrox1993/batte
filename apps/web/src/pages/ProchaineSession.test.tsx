import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { formaterEuros, type Prevision } from '@batte/core';
import { ErreurApi } from '../lib/api';
import {
  avertissementCoutsPrevision,
  cheminComparateurDuLieu,
  etatDepuisErreurPrevision,
  ExplicationPrevision,
  formaterCoutAppelIa,
  formaterFacteur,
  libelleEvenementsPrevision,
  mentionHorizonNul,
  PanneauPrixConcurrents,
} from './ProchaineSession';

/**
 * Câblage de l'explication du moteur (mission du 30/07/2026) :
 * `prevision.explication` (`construireExplication`,
 * `packages/core/src/prevision/moteur.ts`) n'était rendu NULLE PART à
 * l'écran — l'écran reconstruisait sa propre décomposition depuis les
 * facteurs bruts, perdant au passage deux phrases qui comptent : la
 * recommandation ramenée par une contrainte, et l'avertissement « volume
 * transportable non renseigné » ajouté cette nuit.
 *
 * Ce fichier ne monte pas l'écran : comme le reste des tests de cet écran ici
 * (mêmes conventions que `Comptabilite.test.tsx`), on rend le composant PUR
 * via `renderToStaticMarkup` et on vérifie le texte réellement présent dans
 * le balisage. Le montage vit dans `ProchaineSession.montage.test.tsx`.
 */

describe('ExplicationPrevision — le fil vers le rendu', () => {
  it('affiche chaque phrase de l’explication, y compris l’écrêtage et le transport non renseigné', () => {
    const lignes = [
      'Base historique : 118 crêpes.',
      'Demande attendue : 168 crêpes (médiane 160, fourchette 120 à 210).',
      'Recommandation ramenée de 180 à 134 crêpes — limite : capacité de cuisson. Manque à gagner estimé : 12,50 €.',
      "Volume transportable non renseigné — cette contrainte n'est pas contrôlée " +
        "(mesurez la capacité réelle de votre véhicule dans Paramètres pour l'activer).",
    ];

    // `renderToStaticMarkup` échappe l'apostrophe (`&#x27;`) comme tout texte
    // HTML : dans le DOM réel, le nœud de texte porte bien le caractère `'`,
    // c'est uniquement la SOURCE HTML qui l'encode. On décode donc avant de
    // comparer, sans quoi le test échouerait sur un détail d'échappement et
    // non sur le câblage qu'il doit prouver.
    const balisage = renderToStaticMarkup(<ExplicationPrevision lignes={lignes} />).replace(
      /&#x27;/g,
      "'",
    );

    for (const ligne of lignes) {
      expect(balisage).toContain(ligne);
    }
  });

  it('ne rend rien quand le moteur ne produit aucune phrase — jamais une liste vide affichée', () => {
    expect(renderToStaticMarkup(<ExplicationPrevision lignes={[]} />)).toBe('');
  });
});

/**
 * `formaterCoutAppelIa` (mission « garde-fou de dépense », audit du
 * 30/07/2026) : CLAUDE.md §5 exige un compteur de coût PAR APPEL, visible au
 * moment où on le déclenche. Il n'était affiché nulle part — `CommentaireIa`
 * porte `coutCents` depuis le Lot 9, mais `CommentaireClaude` ci-dessus
 * n'affichait que `texte`, jamais le coût.
 *
 * Fonction PURE extraite pour la même raison que `ExplicationPrevision` et
 * `formaterAvertissementEcartsStock` (`Sessions.tsx`) : ce fichier ne monte
 * pas le composant `CommentaireClaude` (qui pilote son état par
 * `useState`/`fetch`), mais la PHRASE affichée reste entièrement vérifiable
 * sans lui.
 *
 * Ce que ce test NE prouve PAS : que `CommentaireClaude` appelle bien cette
 * fonction avec `etat.commentaire.coutCents`, ni que la phrase apparaît
 * réellement à l'écran une fois le commentaire reçu — seul un montage réel du
 * composant le prouverait (`ProchaineSession.montage.test.tsx`).
 */
describe('formaterCoutAppelIa — le coût d’un appel se voit au moment où on le déclenche', () => {
  it('met le montant en euros dans la phrase, jamais les centimes bruts', () => {
    expect(formaterCoutAppelIa(42)).toBe(`Coût de cet appel : ${formaterEuros(42)}.`);
  });

  it(
    'affiche un coût de zéro comme une VALEUR (« 0,00 € »), jamais comme une absence : ' +
      'cette fonction n’est appelée que pour un appel RÉELLEMENT abouti ' +
      '(`disponible: true`), donc un coût nul est un fait, pas une inconnue',
    () => {
      expect(formaterCoutAppelIa(0)).toBe(`Coût de cet appel : ${formaterEuros(0)}.`);
    },
  );
});

/**
 * Croisement Prochaine session ↔ Concurrents (docs/demandes/10).
 *
 * AVANT le 31/07/2026, le contrat `GET /api/prevision` ne renvoyait qu'un NOM
 * de lieu (`session.lieuNom`) : `ProchaineSession.tsx` devait alors deviner
 * l'identifiant via `resoudreLieuIdParNom`, ambigu dès que deux lieux
 * partageaient un nom (`lieu_marche.nom` n'est pas contraint UNIQUE en base,
 * `packages/db/src/schema.ts`). Le contrat porte désormais `session.lieuId`
 * directement (la vraie clé étrangère de la session) : il n'y a donc plus
 * qu'un chemin à construire, jamais un lieu à retrouver.
 */
/**
 * D-082 (`docs/05-DECISIONS.md`) : zéro session close sur le lieu de la
 * prochaine session → aucune prévision, jamais un chiffre. Le serveur
 * l'exprime par le même mécanisme que la session sœur « aucune session
 * planifiée » (`ErreurMetier` + code, `apps/api/src/routes/previsions.ts`) :
 * ce test prouve que l'écran traduit les DEUX codes en états INFORMATIFS
 * distincts, jamais en encadré d'erreur générique — et qu'une vraie panne
 * (code inconnu, ou une erreur qui n'est même pas une `ErreurApi`) retombe
 * bien, elle, sur l'état `erreur`.
 *
 * Ce que ce test NE prouve PAS : que `ProchaineSession` appelle réellement
 * cette fonction dans son `catch` (elle le fait, mais ce fichier ne monte pas
 * le composant — voir `ProchaineSession.montage.test.tsx`), ni que `EtatVide`
 * rend visuellement la bonne variante pour `premier_passage` : jsdom
 * n'applique aucune feuille de style, seul un test end-to-end (Playwright)
 * prouverait le VISUEL.
 */
describe('etatDepuisErreurPrevision — trois « rien à afficher », jamais confondus', () => {
  it('traduit « aucune session planifiée » en état informatif dédié', () => {
    const erreur = new ErreurApi('Aucune session à venir.', {
      code: 'aucune_session_planifiee',
      statut: 404,
    });
    expect(etatDepuisErreurPrevision(erreur)).toEqual({
      statut: 'aucune_session',
      message: 'Aucune session à venir.',
    });
  });

  it(
    'traduit « premier passage » (D-082) en état informatif dédié, DISTINCT ' +
      'de « aucune session » — ce n’est pas la même absence',
    () => {
      const erreur = new ErreurApi(
        'Premier passage à La Batte : aucune session n’y a encore été close, donc aucune ' +
          'prévision de production n’est possible (décision D-082).',
        { code: 'premier_passage_lieu', statut: 422 },
      );
      expect(etatDepuisErreurPrevision(erreur)).toEqual({
        statut: 'premier_passage',
        message: erreur.message,
      });
    },
  );

  it('retombe sur une VRAIE erreur pour tout autre code — jamais silencieusement ignorée', () => {
    const erreur = new ErreurApi('Le serveur a explosé.', {
      code: 'erreur_inattendue',
      statut: 500,
    });
    expect(etatDepuisErreurPrevision(erreur)).toEqual({
      statut: 'erreur',
      message: 'Le serveur a explosé.',
    });
  });

  it('retombe sur un message générique quand l’erreur n’est même pas une ErreurApi', () => {
    expect(etatDepuisErreurPrevision(new Error('panique JS quelconque'))).toEqual({
      statut: 'erreur',
      message: 'La prévision n’a pas pu être calculée.',
    });
  });
});

describe('cheminComparateurDuLieu — construit le chemin filtré, ne devine plus rien', () => {
  it('inclut le lieuId fourni tel quel, sans jamais consulter le NOM du lieu', () => {
    // Aucun paramètre `nom` n'existe plus dans cette signature : c'est la
    // preuve, au niveau du type, que ce filtre ne peut plus redevenir ambigu
    // face à deux lieux homonymes — le cas que `resoudreLieuIdParNom` devait
    // encore gérer avant ce lot.
    expect(cheminComparateurDuLieu('lieu-1')).toBe('/concurrents/comparateur?lieuId=lieu-1');
    expect(cheminComparateurDuLieu('lieu-2')).toBe('/concurrents/comparateur?lieuId=lieu-2');
  });
});

/**
 * `PanneauPrixConcurrents` — rendu à l'état REPLIÉ uniquement.
 *
 * `renderToStaticMarkup` n'exécute aucun `useEffect` (comportement standard
 * du rendu statique React, pas une particularité de ce dépôt) : le premier
 * chargement du comparateur, déclenché par un CLIC sur le bouton bascule,
 * n'a donc aucune chance de se déclencher ici — ce test ne peut prouver que
 * l'état INITIAL (replié), jamais la bascule elle-même, ni que `Échap`
 * referme et rend le focus au bouton (même limite déjà documentée par D-079
 * pour `Comptabilite.tsx`). Ces gestes relèvent de
 * `ProchaineSession.montage.test.tsx`, à côté de ce fichier.
 *
 * Ce que ce test PROUVE : le panneau démarre replié (`aria-expanded="false"`,
 * bouton « Voir les prix concurrents », aucun tableau ni aucun chiffre du
 * comparateur dans le balisage) — exactement ce que « en un clic, pas affiché
 * en permanence » exige.
 */
describe('PanneauPrixConcurrents — replié par défaut (« en un clic », docs/demandes/10)', () => {
  it('démarre replié : bouton bascule visible, aucun contenu du comparateur rendu', () => {
    const session = {
      id: 's1',
      numero: 'S-2026-0031',
      dateSession: '2026-08-02',
      lieuId: 'lieu-1',
      lieuNom: 'La Batte',
    };
    const balisage = renderToStaticMarkup(<PanneauPrixConcurrents session={session} />);

    expect(balisage).toContain('aria-expanded="false"');
    expect(balisage).toContain('Voir les prix concurrents');
    expect(balisage).toContain('La Batte');
    // Rien du contenu déplié (chargé au clic seulement) ne doit fuiter dans
    // le balisage replié — la mention « Notre carte » du sous-titre TOUJOURS
    // visible est volontairement épargnée par ces assertions, qui ciblent
    // uniquement des libellés propres au contenu chargé après le clic.
    expect(balisage).not.toContain('Moyenne de nos crêpes');
    expect(balisage).not.toContain('produits actifs');
    expect(balisage).not.toContain('Calcul du comparateur');
  });
});

/**
 * `libelleEvenementsPrevision` (docs/21-CHAMPS-NON-LUS.md §2.10, audit du
 * 31/07/2026) : `evenements[].impactBp` était calculé, testé, servi par
 * `GET /prevision`, et jamais lu par cet écran — seul le facteur COMBINÉ
 * (`facteurs.evenementBp`, le PRODUIT de tous les impacts individuels,
 * `facteurEvenementBp`, `packages/db/src/depots/previsions.ts`) était affiché.
 * Dès que deux événements coïncident le même jour, le combiné ne permet plus
 * de retrouver la contribution de chacun.
 */
describe('libelleEvenementsPrevision — isole l’impact de CHAQUE événement, pas seulement le combiné', () => {
  const EVENEMENT_UNIQUE: Prevision['evenements'] = [
    { id: 'ev-1', nom: 'Brocante du quartier', type: 'brocante', impactBp: 12_000, mesure: false },
  ];

  it('dit qu’aucun événement ne joue quand la liste est vide', () => {
    expect(libelleEvenementsPrevision([])).toBe('Événement — aucun ce jour-là');
  });

  it('nomme l’événement, son impact INDIVIDUEL formaté en multiplicateur, et son statut mesuré/estimé', () => {
    expect(libelleEvenementsPrevision(EVENEMENT_UNIQUE)).toBe(
      `Événement — Brocante du quartier (${formaterFacteur(12_000)}, estimé)`,
    );
  });

  it(
    'quand DEUX événements coïncident le même jour, isole l’impact de CHACUN — ' +
      'c’est exactement le cas que le facteur combiné, seul affiché avant ce correctif, ne permet pas de démêler',
    () => {
      const deuxEvenements: Prevision['evenements'] = [
        {
          id: 'ev-1',
          nom: 'Brocante du quartier',
          type: 'brocante',
          impactBp: 12_000,
          mesure: false,
        },
        { id: 'ev-2', nom: 'Match à domicile', type: 'sport', impactBp: 9_500, mesure: true },
      ];
      const libelle = libelleEvenementsPrevision(deuxEvenements);

      expect(libelle).toContain(`Brocante du quartier (${formaterFacteur(12_000)}, estimé)`);
      expect(libelle).toContain(`Match à domicile (${formaterFacteur(9_500)}, mesuré)`);
      // Les deux impacts DIFFÈRENT (12 000 contre 9 500 bp) : si l'un des deux
      // avait été oublié au profit du seul facteur combiné, ce test l'aurait
      // vu — un doublon du même nombre pour les deux événements est
      // exactement le défaut qu'un simple `toContain` isolé ne verrait pas.
      expect(formaterFacteur(12_000)).not.toBe(formaterFacteur(9_500));
    },
  );
});

/**
 * `avertissementCoutsPrevision` — la phrase qui empêche l'écran de dire que
 * surproduire est gratuit.
 *
 * Le montage (`ProchaineSession.montage.test.tsx`) prouve QUAND elle apparaît
 * et où ; ce fichier prouve CE QU'ELLE DIT, cas par cas. Les deux inconnues
 * sont INDÉPENDANTES : les confondre derrière un seul drapeau enverrait le
 * porteur ressaisir ce qu'il a déjà saisi — c'est exactement le défaut corrigé
 * sur `lieux-rentabilite` et `opportunites` (fiche 13, 30/07/2026).
 */
describe('avertissementCoutsPrevision — nommer ce qui manque, et rien d’autre', () => {
  function couts(surcharges: Partial<Prevision['couts']> = {}): Prevision['couts'] {
    return {
      coutRuptureCents: 317,
      coutInvenduCents: 33,
      coutInvenduConnu: true,
      prixMoyenConnu: true,
      origine: 'Mesurés sur vos productions et vos ventes.',
      ...surcharges,
    };
  }

  it('rend `null` quand les deux coûts sont connus — rien à avertir', () => {
    expect(avertissementCoutsPrevision(couts())).toBeNull();
  });

  it('coût matière inconnu : nomme la recette, PAS le prix de vente', () => {
    const message = avertissementCoutsPrevision(couts({ coutInvenduConnu: false }));

    expect(message).not.toBeNull();
    expect(message).toContain('coût matière');
    expect(message).not.toContain('prix de vente');
  });

  it('prix moyen inconnu : nomme le produit transformé, PAS la recette', () => {
    const message = avertissementCoutsPrevision(couts({ prixMoyenConnu: false }));

    expect(message).not.toBeNull();
    expect(message).toContain('prix de vente');
    expect(message).not.toContain('coût matière');
  });

  it('les deux inconnus : les deux sont nommés, reliés par « et »', () => {
    const message = avertissementCoutsPrevision(
      couts({ coutInvenduConnu: false, prixMoyenConnu: false }),
    );

    expect(message).not.toBeNull();
    expect(message).toContain('prix de vente');
    expect(message).toContain('coût matière');
    expect(message).toContain(' et ');
  });

  it('dit toujours ce que l’absence a PRODUIT — pas seulement ce qui manque', () => {
    const message = avertissementCoutsPrevision(couts({ coutInvenduConnu: false }));

    // Sans cette phrase, le porteur lirait « il manque une donnée » sans
    // savoir que le volume affiché au-dessus a été arbitré avec un zéro.
    expect(message).toContain('comme si cette valeur était de zéro');
  });
});

/**
 * D-098 — le troisième cas de l'intervalle : ni mesuré, ni inconnu, SANS OBJET.
 *
 * Aucune horloge n'est lue ici, et ce n'est pas une précaution de test : c'est
 * la conséquence du choix d'architecture. `horizonJours` est un fait CALCULÉ
 * SERVEUR et porté par `schemaPrevision` ; cette fonction ne fait que le
 * traduire en phrase. Le jour où ce fichier est relu n'entre nulle part —
 * exactement ce que la quatrième forme de fixture aveugle
 * (`docs/39-DOCTRINE-DES-AGENTS.md` §3) exige.
 */
describe('mentionHorizonNul — dire pourquoi l’intervalle se resserre, sans crier', () => {
  it('à horizon NUL, nomme le troisième cas et ferme les deux contresens', () => {
    const message = mentionHorizonNul(0);

    expect(message).not.toBeNull();
    // Le fait, d'abord : pourquoi il n'y a plus d'incertitude d'horizon.
    expect(message).toContain('Le marché a lieu aujourd’hui');
    expect(message).toContain('ce n’est plus une prévision');
    // Le troisième cas, nommé : ni « mesuré », ni « inconnu ».
    expect(message).toContain('sans objet');
    expect(message).toContain('ni mesuré ni inconnu');
    // Contresens 1 — « c'est en panne ».
    expect(message).toContain('n’a simplement pas lieu d’être');
    // Contresens 2 — « la prévision est donc plus fiable aujourd'hui ».
    expect(message).toContain('pas parce que la prévision serait plus sûre');
  });

  it('dès que la session n’est pas ce jour même, il n’y a RIEN à dire', () => {
    // 1 est le voisin immédiat de 0 : le seuil doit être exactement là, pas
    // « à quelques jours près ». 6 est l'horizon d'un dimanche vu du lundi.
    expect(mentionHorizonNul(1)).toBeNull();
    expect(mentionHorizonNul(6)).toBeNull();
    expect(mentionHorizonNul(300)).toBeNull();
  });
});
