/**
 * Le client Claude, eprouve SANS jamais appeler l'API Anthropic.
 *
 * Trois choses se verifient ici, et aucune ne demande de vrai appel :
 *
 *  1. **Le mode degrade est complet** (CLAUDE.md §5). Sans cle, plafond a zero,
 *     plafond atteint : la fonction rend un refus MOTIVE, jamais une exception.
 *  2. **Le plafond est verifie AVANT l'appel**, sur le cout MAXIMAL possible.
 *     Un plafond verifie apres coup ne protege rien : la depense est engagee.
 *  3. **Aucun texte tiers ne franchit la frontiere.** Le chemin d'echec est
 *     reellement parcouru en pointant `ANTHROPIC_BASE_URL` sur un port local
 *     ferme : la connexion est refusee en boucle locale, rien ne sort du poste,
 *     et l'on observe ce que l'application fait d'un message d'exception.
 *
 * Le port 1 de 127.0.0.1 n'ecoute jamais : c'est une panne reseau reproductible,
 * pas un appel a un service.
 */

import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CATALOGUE_PARAMETRES,
  Parametres,
  coutMaximalCents,
  estimerTokens,
  familleModele,
  nouvelIdentifiant,
  tarifModele,
} from '@batte/core';
import { creerBase, listerAppelsIa, migrer, schema, type BaseBatte } from '@batte/db';
import { assistanceConfiguree, demanderCommentaire, reinitialiserClientIa } from './client.js';
import type { DemandeIa } from './client.js';

/** Valeur temoin : sa seule presence dans une sortie est une preuve de fuite. */
const SENTINELLE_CLE = 'sk-ant-api03-SENTINELLE0CLIENT0NE0DOIT0JAMAIS0SORTIR';

/** Un port local qui n'ecoute pas : connexion refusee immediatement, hors reseau. */
const BASE_URL_MORTE = 'http://127.0.0.1:1';

const DEMANDE: DemandeIa = {
  usage: 'analyse_ecart',
  consigne: 'Tu commentes des chiffres déjà calculés. Tu ne produis JAMAIS de chiffre.',
  contenu: 'Session SM-2026-0001 : 134 crêpes vendues, 16 invendues.',
};

/** Rejoue le catalogue en surchargeant une cle — pour tester un plafond different. */
function parametresAvec(surcharges: Record<string, string> = {}): Parametres {
  return Parametres.depuisLignes(
    CATALOGUE_PARAMETRES.map((d) => ({
      cle: d.cle,
      valeur: surcharges[d.cle] ?? d.valeurDefaut,
    })),
  );
}

/** Motifs qu'aucune sortie — corps HTTP ou ligne de journal — ne doit porter. */
const MOTIFS_INTERDITS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{6,}/,
  /SENTINELLE0/,
  /node_modules/i,
  /\bat [A-Za-z<][\w.<>]*\s\(/,
  /[A-Za-z]:[\\/]Users[\\/]/i,
];

function attendreAucuneFuite(texte: string, contexte: string): void {
  for (const motif of MOTIFS_INTERDITS) {
    expect(texte, `${contexte} : ${String(motif)}`).not.toMatch(motif);
  }
}

let base: BaseBatte;
const envInitial: Record<string, string | undefined> = {};

function definir(cle: string, valeur: string | undefined): void {
  if (!(cle in envInitial)) envInitial[cle] = process.env[cle];
  if (valeur === undefined) delete process.env[cle];
  else process.env[cle] = valeur;
}

beforeEach(() => {
  base = creerBase(':memory:');
  migrer(base);
  definir('ANTHROPIC_API_KEY', undefined);
  definir('ANTHROPIC_BASE_URL', undefined);
  reinitialiserClientIa();
});

afterEach(() => {
  for (const [cle, valeur] of Object.entries(envInitial)) {
    if (valeur === undefined) delete process.env[cle];
    else process.env[cle] = valeur;
  }
  reinitialiserClientIa();
});

/* ═══════════════════════════════════════════════════════════════════════════
   1. Mode dégradé : l'application marche sans Claude
   ═══════════════════════════════════════════════════════════════════════════ */

describe('mode dégradé', () => {
  it('sans clé : refus motivé, aucune exception, aucun appel journalisé', async () => {
    expect(assistanceConfiguree()).toBe(false);

    const reponse = await demanderCommentaire(base, parametresAvec(), DEMANDE);

    expect(reponse.disponible).toBe(false);
    if (!reponse.disponible) {
      // Le message nomme la VARIABLE a renseigner, jamais une valeur.
      expect(reponse.raison).toContain('ANTHROPIC_API_KEY');
      attendreAucuneFuite(reponse.raison, 'refus sans clé');
    }
    // Rien n'a ete tente : pas de ligne de journal, donc pas de faux compteur.
    expect(listerAppelsIa(base)).toHaveLength(0);
  });

  it('plafond à zéro : l’assistance est coupée bien qu’une clé soit configurée', async () => {
    definir('ANTHROPIC_API_KEY', SENTINELLE_CLE);
    definir('ANTHROPIC_BASE_URL', BASE_URL_MORTE);
    reinitialiserClientIa();
    expect(assistanceConfiguree()).toBe(true);

    const reponse = await demanderCommentaire(
      base,
      parametresAvec({ plafond_ia_mensuel_cents: '0' }),
      DEMANDE,
    );

    expect(reponse.disponible).toBe(false);
    if (!reponse.disponible) {
      // La raison est celle du PLAFOND, pas celle d'une panne réseau : preuve
      // que la coupure a eu lieu avant toute tentative de connexion.
      expect(reponse.raison).toContain('désactivée');
      attendreAucuneFuite(reponse.raison, 'refus plafond zéro');
    }
    expect(listerAppelsIa(base)).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Le plafond protège AVANT la dépense
   ═══════════════════════════════════════════════════════════════════════════ */

describe('plafond mensuel', () => {
  /**
   * Instant de reference FIXE, au milieu d'un mois.
   *
   * `demanderCommentaire` accepte une horloge injectable ; on s'en sert pour
   * que le mois civil belge du controle de plafond soit le meme que celui de
   * la depense pre-inscrite, sans dependre de la date du jour.
   */
  const MILIEU_DE_MOIS = new Date('2026-07-15T12:00:00.000Z');

  /** Inscrit une depense deja engagee ce mois-la, comme le ferait un vrai appel. */
  function inscrireDepense(coutCents: number): void {
    base
      .insert(schema.journalIa)
      .values({
        id: nouvelIdentifiant(),
        dateAppel: MILIEU_DE_MOIS.toISOString(),
        usage: 'analyse_ecart',
        modele: 'modele-de-test',
        tokensEntree: 1000,
        tokensSortie: 500,
        coutCents,
        promptHash: null,
        reponseBrute: null,
        valideeParHumain: null,
        dureeMs: 1200,
        erreur: null,
      })
      .run();
  }

  it('refuse AVANT d’ouvrir la moindre connexion quand le budget est consommé', async () => {
    definir('ANTHROPIC_API_KEY', SENTINELLE_CLE);
    definir('ANTHROPIC_BASE_URL', BASE_URL_MORTE);
    reinitialiserClientIa();

    const parametres = parametresAvec();
    inscrireDepense(parametres.centimes('plafond_ia_mensuel_cents'));

    const reponse = await demanderCommentaire(base, parametres, DEMANDE, () => MILIEU_DE_MOIS);

    expect(reponse.disponible).toBe(false);
    if (!reponse.disponible) {
      expect(reponse.raison).toContain('Plafond mensuel atteint');
      // Si l'appel etait parti, la raison parlerait de réseau et non de plafond :
      // c'est la preuve que la coupure precede la depense, et non l'inverse.
      expect(reponse.raison).not.toContain('injoignable');
      // Le refus CHIFFRE le plafond, pour que l'utilisateur sache quoi relever.
      expect(reponse.raison).toMatch(/\d+,\d{2}\s?€/);
      attendreAucuneFuite(reponse.raison, 'refus plafond atteint');
    }
    // Une seule ligne : celle de la fixture. Le refus n'en a ajouté aucune.
    expect(listerAppelsIa(base)).toHaveLength(1);
  });

  it('compte le coût MAXIMAL possible, pas le coût moyen espéré', async () => {
    definir('ANTHROPIC_API_KEY', SENTINELLE_CLE);
    definir('ANTHROPIC_BASE_URL', BASE_URL_MORTE);
    reinitialiserClientIa();

    const parametres = parametresAvec();
    const plafond = parametres.centimes('plafond_ia_mensuel_cents');
    const tarif = tarifModele(familleModele(DEMANDE.usage), parametres);
    const coutMax = coutMaximalCents(
      estimerTokens(DEMANDE.consigne) + estimerTokens(DEMANDE.contenu),
      parametres.entier('ia_tokens_sortie_max'),
      tarif,
    );

    // Il reste EXACTEMENT de quoi payer le pire cas moins un centime : un
    // controle qui raisonnerait sur une sortie « typique » laisserait passer.
    inscrireDepense(plafond - coutMax + 1);

    const reponse = await demanderCommentaire(base, parametres, DEMANDE, () => MILIEU_DE_MOIS);

    expect(reponse.disponible).toBe(false);
    if (!reponse.disponible) expect(reponse.raison).toContain('Plafond mensuel atteint');
    expect(listerAppelsIa(base)).toHaveLength(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Chemin d'échec réel : ce que l'utilisateur reçoit, ce que le journal garde
   ═══════════════════════════════════════════════════════════════════════════ */

describe('échec d’appel', () => {
  it('ne renvoie AUCUN texte de la bibliothèque au navigateur, et journalise assaini', async () => {
    definir('ANTHROPIC_API_KEY', SENTINELLE_CLE);
    definir('ANTHROPIC_BASE_URL', BASE_URL_MORTE);
    reinitialiserClientIa();

    const reponse = await demanderCommentaire(base, parametresAvec(), DEMANDE);

    /* — Ce que voit le navigateur — */
    expect(reponse.disponible).toBe(false);
    if (!reponse.disponible) {
      attendreAucuneFuite(reponse.raison, 'raison HTTP');
      // Ni l'adresse visee, ni le code errno d'undici : la raison est une
      // phrase francaise ecrite par l'application.
      expect(reponse.raison).not.toContain('127.0.0.1');
      expect(reponse.raison).not.toContain('ECONNREFUSED');
      expect(reponse.raison.trimEnd()).toMatch(/[.!?»]$/);
      expect(reponse.raison).toContain('reste utilisable');
    }

    /* — Ce que garde le journal, lui aussi servi en HTTP — */
    const appels = listerAppelsIa(base);
    expect(appels).toHaveLength(1);
    const appel = appels[0]!;
    expect(appel.erreur).not.toBeNull();
    attendreAucuneFuite(appel.erreur ?? '', 'journal_ia.erreur');
    // Un echec sans reponse n'a rien coute : le compteur reste honnete.
    expect(appel.coutCents).toBe(0);
    expect(appel.tokensEntree).toBe(0);
    // La trace reste bornee : le journal est lu a l'ecran, pas grepe.
    expect((appel.erreur ?? '').length).toBeLessThan(400);
    // Elle dit tout de meme QUELQUE CHOSE : un echec silencieux est interdit.
    expect((appel.erreur ?? '').trim().length).toBeGreaterThan(5);
  }, 30_000);

  it('ne lève jamais : une panne réseau n’a pas le droit de casser l’écran', async () => {
    definir('ANTHROPIC_API_KEY', SENTINELLE_CLE);
    definir('ANTHROPIC_BASE_URL', BASE_URL_MORTE);
    reinitialiserClientIa();

    await expect(demanderCommentaire(base, parametresAvec(), DEMANDE)).resolves.toBeDefined();
  }, 30_000);
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. La clé n'a aucun chemin vers la sortie
   ═══════════════════════════════════════════════════════════════════════════ */

describe('confinement de la clé', () => {
  it('assistanceConfiguree ne rend qu’un booléen', () => {
    definir('ANTHROPIC_API_KEY', SENTINELLE_CLE);
    reinitialiserClientIa();
    expect(typeof assistanceConfiguree()).toBe('boolean');
    expect(assistanceConfiguree()).toBe(true);
  });

  it('une clé faite d’espaces vaut une clé absente', () => {
    // Sinon `new Anthropic({ apiKey: '   ' })` partirait a chaque affichage et
    // l'utilisateur verrait une erreur d'authentification au lieu du message
    // « assistance non configurée ».
    definir('ANTHROPIC_API_KEY', '   ');
    reinitialiserClientIa();
    expect(assistanceConfiguree()).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. Panne HTTP REELLE (serveur local, jamais l'API Anthropic)
   ═══════════════════════════════════════════════════════════════════════════

   Tout ce qui precede prouve le cas `statut === null` (port mort, aucune
   reponse HTTP). Il manquait le cas « cle invalide » explicitement demande par
   l'audit : une VRAIE exception du SDK, avec un `.status` numerique reellement
   extrait par `statutHttpDe` (prive, non exporte) — pas un objet `{ status }`
   fabrique a la main. Meme recette que
   `apps/api/src/routes/evenements-decouverte.test.ts` (serveur `node:http`
   local qui IMITE la forme d'une reponse HTTP Anthropic) : `ANTHROPIC_BASE_URL`
   pointe dessus, la requete ne quitte donc jamais ce poste. */

describe('panne HTTP réelle (serveur local, jamais l’API Anthropic)', () => {
  /**
   * Serveur HTTP local qui rend TOUJOURS le meme statut, corps et en-tetes —
   * jamais l'API Anthropic reelle. `x-should-retry: false` est utilise pour
   * les statuts que le SDK reprend par defaut (429, 5xx) : le test verifie
   * l'EXTRACTION du statut par ce module, pas la politique de reprise du SDK.
   */
  function demarrerServeurStatutFixe(
    statut: number,
    corps: unknown,
    entetes: Record<string, string> = {},
  ): Promise<{ url: string; fermer: () => Promise<void> }> {
    return new Promise((resolve) => {
      const serveur: Server = createServer((requete, reponse) => {
        requete.on('data', () => {});
        requete.on('end', () => {
          reponse.writeHead(statut, { 'content-type': 'application/json', ...entetes });
          reponse.end(JSON.stringify(corps));
        });
      });
      serveur.listen(0, '127.0.0.1', () => {
        const adresse = serveur.address();
        const port = typeof adresse === 'object' && adresse !== null ? adresse.port : 0;
        resolve({
          url: `http://127.0.0.1:${port}`,
          fermer: () => new Promise((resoudre) => serveur.close(() => resoudre())),
        });
      });
    });
  }

  it('clé refusée (401 réel) : la raison nomme ANTHROPIC_API_KEY, jamais le corps du SDK', async () => {
    definir('ANTHROPIC_API_KEY', SENTINELLE_CLE);
    reinitialiserClientIa();

    // Le corps porte volontairement la « clé » en clair, comme le ferait le
    // vrai message d'erreur d'authentification du SDK : la preuve que rien de
    // ce texte ne ressort tient a `raisonEchecIa`, qui ne lit qu'un statut.
    const serveur = await demarrerServeurStatutFixe(401, {
      type: 'error',
      error: { type: 'authentication_error', message: `invalid x-api-key: ${SENTINELLE_CLE}` },
    });
    definir('ANTHROPIC_BASE_URL', serveur.url);
    reinitialiserClientIa();

    try {
      const reponse = await demanderCommentaire(base, parametresAvec(), DEMANDE);

      expect(reponse.disponible).toBe(false);
      if (!reponse.disponible) {
        expect(reponse.raison).toContain('ANTHROPIC_API_KEY');
        attendreAucuneFuite(reponse.raison, '401 réel');
        // Le corps de la reponse du serveur (texte du SDK) ne ressort jamais,
        // meme partiellement.
        expect(reponse.raison).not.toContain('authentication_error');
      }

      const appels = listerAppelsIa(base);
      expect(appels).toHaveLength(1);
      expect(appels[0]!.erreur).toContain('HTTP 401');
      attendreAucuneFuite(appels[0]!.erreur ?? '', 'journal 401 réel');
      // Un echec sans reponse exploitable n'a rien coute au plafond.
      expect(appels[0]!.coutCents).toBe(0);
    } finally {
      await serveur.fermer();
    }
  }, 15_000);

  it('panne serveur (500 réel) : message générique, jamais confondu avec une clé refusée', async () => {
    definir('ANTHROPIC_API_KEY', SENTINELLE_CLE);
    reinitialiserClientIa();

    const serveur = await demarrerServeurStatutFixe(
      500,
      { type: 'error', error: { type: 'api_error', message: 'internal server error' } },
      { 'x-should-retry': 'false' },
    );
    definir('ANTHROPIC_BASE_URL', serveur.url);
    reinitialiserClientIa();

    try {
      const reponse = await demanderCommentaire(base, parametresAvec(), DEMANDE);

      expect(reponse.disponible).toBe(false);
      if (!reponse.disponible) {
        // Une panne du fournisseur ne doit surtout pas pousser a modifier une
        // cle qui fonctionne (packages/core/src/ia-securite.test.ts le fige
        // deja pour `raisonEchecIa` seule ; ceci le prouve sur le chemin REEL).
        expect(reponse.raison).not.toContain('ANTHROPIC_API_KEY');
        expect(reponse.raison).toContain('panne');
        attendreAucuneFuite(reponse.raison, '500 réel');
      }

      const appels = listerAppelsIa(base);
      expect(appels).toHaveLength(1);
      expect(appels[0]!.erreur).toContain('HTTP 500');
      attendreAucuneFuite(appels[0]!.erreur ?? '', 'journal 500 réel');
    } finally {
      await serveur.fermer();
    }
  }, 15_000);
});
