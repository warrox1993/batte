/**
 * Ce qu'on ENVOIE a Claude — le contenu le plus sensible du Lot 9.
 *
 * Deux invariants sont figes ici :
 *
 *  1. **Chaque usage porte l'interdiction de produire un chiffre**
 *     (CLAUDE.md §3 regle 2). Elle vit dans un socle partage, concatene dans
 *     chaque consigne : ce test verifie qu'elle est bien presente dans la
 *     consigne ENVOYEE, usage par usage, et non seulement dans la constante.
 *     Un quatrieme usage ecrit sans le socle ferait tomber ce fichier.
 *
 *  2. **Rien du poste ne part avec le prompt** : ni chemin de fichier, ni nom
 *     d'utilisateur du systeme, ni valeur d'environnement. Un prompt est du
 *     texte qui quitte la machine ; c'est une frontiere de sortie au meme titre
 *     qu'une reponse HTTP.
 *
 * Aucun appel reseau : on construit les demandes et on lit ce qu'elles
 * contiennent. C'est justement le point — le contenu se relit sans rien envoyer.
 */

import { describe, expect, it } from 'vitest';
import { formaterEuros, type Prevision } from '@batte/core';
import * as usages from './usages.js';
import type { DemandeIa } from './client.js';

/* ── Fixtures : des chiffres de test, jamais des valeurs metier ───────────── */

const PREVISION: Prevision = {
  session: { id: 'ses-1', numero: 'SM-2026-0001', dateSession: '2026-08-02', lieuNom: 'La Batte' },
  baseline: {
    baselineCrepes: 120,
    nbSessionsRetenues: 4,
    poidsPriorBp: 2500,
    explication: 'Moyenne des 4 dernières sessions comparables.',
  },
  meteo: {
    disponible: true,
    conditions: {
      temperatureC: 19,
      precipitationsMm: 0,
      ventKmh: 12,
      couvertureNuageuseBp: 3000,
    },
    categorie: 'favorable',
    facteurBp: 11000,
    ventFort: false,
    explication: 'Temps sec et doux.',
    recupereLe: '2026-08-01T06:00:00.000Z',
  },
  facteurs: { meteoBp: 11000, evenementBp: 10000, saisonBp: 10000, tendanceBp: 10000 },
  p10: 100,
  p50: 130,
  p90: 165,
  couts: {
    coutRuptureCents: 250,
    coutInvenduCents: 40,
    origine: 'Marge et coût matière réels.',
    coutInvenduConnu: true,
    prixMoyenConnu: true,
  },
  quantileCibleBp: 8600,
  crepesRecommandees: 150,
  crepesRetenues: 150,
  contraintes: [],
  contrainteLimitante: null,
  manqueAGagnerCents: 0,
  confianceBp: 6000,
  nbSessionsComparables: 4,
  explication: 'Prévision fondée sur 4 sessions comparables.',
  evenements: [
    { id: 'ev-1', nom: 'Brocante du quartier', type: 'brocante', impactBp: 1200, mesure: false },
  ],
} as unknown as Prevision;

const ECART: usages.EcartSession = {
  numero: 'SM-2026-0001',
  dateSession: '2026-08-02',
  crepesProduites: 150,
  crepesVendues: 134,
  crepesInvendues: 16,
  caTotalCents: 83_800,
  margeNetteCents: 41_200,
  ecartCaisseCents: 0,
  prevuCrepes: 150,
  notesQualitatives: 'Averse à 11 h, file d’attente courte ensuite.',
};

/**
 * Toutes les demandes que ce module sait construire.
 *
 * La liste est CONFRONTEE plus bas au nombre de fonctions reellement exportees :
 * ajouter un usage sans l'ajouter ici fait tomber la suite. C'est la lecon de
 * D-045 — une liste ecrite a la main n'est pas une preuve d'absence.
 */
const DEMANDES: readonly { readonly nom: string; readonly demande: DemandeIa }[] = [
  { nom: 'commentaireDePrevision', demande: usages.commentaireDePrevision(PREVISION) },
  { nom: 'analyseEcart', demande: usages.analyseEcart(ECART) },
  {
    nom: 'briefAvantMarche',
    demande: usages.briefAvantMarche({
      prevision: PREVISION,
      alertesStock: ['Farine T55'],
      alertesDlc: ['Lait entier — DLC 2026-08-05'],
    }),
  },
];

/* ── 1. L'interdiction, dans CHAQUE consigne envoyée ──────────────────────── */

describe('interdiction de produire un chiffre', () => {
  it('figure dans la consigne de chaque usage, pas seulement dans le socle', () => {
    for (const { nom, demande } of DEMANDES) {
      expect(demande.consigne, nom).toContain('Tu ne produis JAMAIS de chiffre');
      expect(demande.consigne, nom).toContain("le calcul appartient à l'application");
    }
  });

  it('aucune consigne ne demande un nombre à Claude', () => {
    // Verbes qui trahiraient une demande de calcul. Le moteur de prevision est
    // deterministe et ecrit en TypeScript (CLAUDE.md §3 regle 2).
    const verbesInterdits = [
      /\bcalcule[rz]?\b(?!.*appartient)/i,
      /\bestime[rz]? (?:le|la|les) nombre/i,
      /\bcombien\b/i,
    ];
    for (const { nom, demande } of DEMANDES) {
      for (const verbe of verbesInterdits) {
        const consigneSansSocle = demande.consigne.split('RÈGLES ABSOLUES')[1] ?? demande.consigne;
        expect(consigneSansSocle, `${nom} / ${String(verbe)}`).not.toMatch(verbe);
      }
    }
  });

  it('couvre TOUTES les fonctions exportées par le module', () => {
    const exportees = Object.entries(usages)
      .filter(([, valeur]) => typeof valeur === 'function')
      .map(([nom]) => nom)
      .sort();
    const couvertes = DEMANDES.map((d) => d.nom).sort();

    expect(
      exportees,
      `usages non testés : ${exportees.filter((n) => !couvertes.includes(n)).join(', ')}`,
    ).toEqual(couvertes);
  });
});

/* ── 2. Rien du poste ne part avec le prompt ──────────────────────────────── */

describe('contenu envoyé à Claude', () => {
  /**
   * Sentinelles posees dans l'environnement du processus de test : si l'une
   * apparait dans un prompt, c'est qu'une valeur de `.env` a fui vers l'API.
   */
  const SENTINELLE = 'SENTINELLE0PROMPT0NE0DOIT0JAMAIS0PARTIR';

  it('ne transporte ni chemin du poste, ni secret, ni identifiant technique', () => {
    process.env['ANTHROPIC_API_KEY'] = `sk-ant-api03-${SENTINELLE}`;
    process.env['SMTP_MOT_DE_PASSE'] = SENTINELLE;
    try {
      for (const { nom, demande } of DEMANDES) {
        const prompt = `${demande.consigne}\n${demande.contenu}`;

        expect(prompt, `${nom} : secret d'environnement`).not.toContain(SENTINELLE);
        expect(prompt, `${nom} : chemin Windows`).not.toMatch(/[A-Za-z]:[\\/]/);
        expect(prompt, `${nom} : chemin POSIX absolu`).not.toMatch(
          /(?:^|\s)\/(?:home|Users|usr|etc)\//,
        );
        expect(prompt, `${nom} : dépendance`).not.toMatch(/node_modules/i);
        // Les identifiants techniques n'apprennent rien a un modele et sont un
        // pur surcout de tokens : le prompt parle numeros metier et dates.
        expect(prompt, `${nom} : identifiant technique`).not.toContain('ses-1');
        expect(prompt, `${nom} : identifiant technique`).not.toContain('ev-1');
      }
    } finally {
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['SMTP_MOT_DE_PASSE'];
    }
  });

  it('n’envoie aucune donnée personnelle : le domaine n’en produit pas (§3 règle 9)', () => {
    // Il n'existe aucun champ « client » dans le modele. Ce test garde la porte :
    // si un jour un nom ou un e-mail entrait dans une session, il finirait ici.
    for (const { nom, demande } of DEMANDES) {
      expect(demande.contenu, nom).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    }
  });

  it('classe chaque usage sur un modèle prévu par le contrat', () => {
    const usagesValides = ['prevision', 'analyse_ecart', 'extraction', 'synthese', 'evenements'];
    for (const { nom, demande } of DEMANDES) {
      expect(usagesValides, nom).toContain(demande.usage);
    }
  });

  /**
   * Le mensonge « inconnu affiché comme zéro », adressé cette fois à un lecteur
   * qui ne peut PAS aller vérifier.
   *
   * `coutInvenduCents` et `coutRuptureCents` valent `0` quand la matière n'est
   * pas chiffrable — aucune production, ou aucune recette dont tous les
   * ingrédients ont un conditionnement au prix connu. Les envoyer tels quels
   * faisait commenter la prévision par un modèle CONVAINCU QU'UN INVENDU NE
   * COÛTE RIEN, donc porté à juger la quantité retenue trop prudente, avec
   * l'assurance d'un chiffre.
   *
   * CLAUDE.md §3 règle 2 dit que Claude COMMENTE les chiffres — encore faut-il
   * ne pas lui en fournir de faux. Trouvé le 01/08/2026 en corrigeant le même
   * mensonge à l'écran.
   */
  describe('coûts inconnus : ce qui part vers Claude ne dit jamais « 0,00 € »', () => {
    function previsionAvecCouts(couts: Record<string, unknown>): Prevision {
      return { ...PREVISION, couts: { ...PREVISION.couts, ...couts } } as unknown as Prevision;
    }

    it('un coût d’invendu INCONNU part en « INCONNU », jamais en « 0,00 € »', () => {
      const contenu = usages.commentaireDePrevision(
        previsionAvecCouts({ coutInvenduCents: 0, coutInvenduConnu: false }),
      ).contenu;

      expect(contenu).toContain("Coût d'un invendu : INCONNU");
      // Le montant formaté ne doit apparaître NULLE PART sur cette ligne — et
      // on le compare via le formateur, jamais via un littéral : `Intl` insère
      // une espace insécable avant le « € ».
      const ligneInvendu = contenu.split('\n').find((l) => l.includes("Coût d'un invendu")) ?? '';
      expect(ligneInvendu).not.toContain(formaterEuros(0));
    });

    it('une rupture devient INCONNUE dès que le coût matière l’est — elle s’en déduit', () => {
      // `coutRuptureCents = max(0, prix − matière)` : une matière comptée pour
      // zéro gonfle la marge perdue d'autant. Le drapeau du prix seul ne suffit
      // donc pas à la rendre sûre.
      const contenu = usages.commentaireDePrevision(
        previsionAvecCouts({ coutInvenduConnu: false }),
      ).contenu;

      expect(contenu).toContain("Coût d'une rupture : INCONNU");
    });

    it('les deux chiffres partent normalement quand ils sont connus', () => {
      const contenu = usages.commentaireDePrevision(PREVISION).contenu;

      expect(contenu).toContain(formaterEuros(250));
      expect(contenu).toContain(formaterEuros(40));
      expect(contenu).not.toContain('INCONNU');
    });
  });
});
