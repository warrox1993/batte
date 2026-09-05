/**
 * Ce qui a le droit de SORTIR d'un echec d'appel Claude.
 *
 * Le message d'une exception levee par le SDK Anthropic, par `fetch` ou par le
 * systeme n'est pas ecrit par nous. Il finissait pourtant :
 *   - dans le corps HTTP de `/api/ia/analyse-ecart/:id` et `/prevision/commenter` ;
 *   - dans `journal_ia.erreur`, que `GET /api/ia/journal` renvoie au navigateur.
 *
 * Deux frontieres de sortie, donc, soumises a CLAUDE.md §2 (« la cle ne doit
 * jamais atteindre le navigateur ») et §7. Ce fichier fige la regle : la RAISON
 * affichee ne contient que du texte ecrit par nous, et la trace conservee est
 * assainie et bornee.
 */

import { describe, expect, it } from 'vitest';
import { assainirDetailIa, detailEchecPourJournal, raisonEchecIa } from './ia.js';

/**
 * Les memes motifs que le balayage anti-fuite des tests d'integration
 * (`apps/api/src/routes/integration.test.ts`). Recopies et non importes : ce
 * paquet ne depend pas de l'API, et une regle de securite qui ne tient que par
 * un import se perd au premier deplacement de fichier.
 */
const MOTIFS_INTERDITS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{6,}/,
  /\bBearer\s+[A-Za-z0-9._-]{10,}/i,
  /node_modules/i,
  /\bat [A-Za-z<][\w.<>]*\s\(/, // debut d'une pile d'appel Node
  /[A-Za-z]:[\\/]Users[\\/]/i, // arborescence du poste Windows
];

function attendreAucuneFuite(texte: string): void {
  for (const motif of MOTIFS_INTERDITS) {
    expect(texte, `« ${String(motif)} » a franchi la frontière`).not.toMatch(motif);
  }
}

/**
 * Messages d'echec REELLEMENT observables sur ce chemin.
 *
 * Chacun est une forme documentee : erreur d'authentification du SDK, panne
 * reseau d'undici, module introuvable, pile d'appel Node, URL signee.
 */
const MESSAGES_HOSTILES: readonly string[] = [
  'Connection error. Cause: connect ECONNREFUSED 127.0.0.1:443',
  '401 {"type":"error","error":{"message":"invalid x-api-key: sk-ant-api03-AbCdEf123456"}}',
  'Request failed: authorization: Bearer sk-ant-api03-ZzZzZzZzZzZzZzZz',
  'Cannot find module ' +
    "'C:\\Users\\jeanb\\Desktop\\AppCrepe\\node_modules\\@anthropic-ai\\sdk\\index.js'",
  'fetch failed to https://api.anthropic.com/v1/messages?api_key=sk-ant-api03-Secret1234',
  'TypeError: x is not a function\n    at demanderCommentaire (/home/jeanb/appcrepe/src/ia/client.ts:120:5)\n    at process.processTicksAndRejections',
  'read ENOENT /home/jeanb/.config/anthropic/credentials.json',
];

describe('assainirDetailIa', () => {
  it('masque tout ce que le balayage anti-fuite interdit', () => {
    for (const message of MESSAGES_HOSTILES) {
      attendreAucuneFuite(assainirDetailIa(message));
    }
  });

  it('borne la longueur : un journal n’est pas un vidage de mémoire', () => {
    const enorme = `panne ${'x'.repeat(5000)}`;
    const assaini = assainirDetailIa(enorme);
    // Borne exacte non figee ici : ce qui compte est qu'elle existe et qu'elle
    // reste lisible a l'ecran.
    expect(assaini.length).toBeLessThan(400);
    expect(assaini.endsWith('…')).toBe(true);
  });

  it('conserve ce qui aide au diagnostic quand rien n’est sensible', () => {
    const assaini = assainirDetailIa('Connection error. Cause: connect ETIMEDOUT');
    expect(assaini).toContain('ETIMEDOUT');
  });

  it('ne rend jamais une chaîne vide, même sur un message entièrement masqué', () => {
    // Un journal avec une case vide ne dit pas « rien de sensible », il dit
    // « on ne sait pas » — et on ne saurait pas distinguer les deux.
    expect(assainirDetailIa('   ').trim()).not.toBe('');
    expect(assainirDetailIa('/usr/local/lib/node_modules/x').trim()).not.toBe('');
  });

  it('reste stable si on l’applique deux fois', () => {
    for (const message of MESSAGES_HOSTILES) {
      const une = assainirDetailIa(message);
      expect(assainirDetailIa(une)).toBe(une);
    }
  });
});

describe('raisonEchecIa', () => {
  /** Tous les statuts que l'API Claude peut rendre, plus l'absence de statut. */
  const STATUTS: readonly (number | null)[] = [null, 400, 401, 403, 404, 429, 500, 503, 529];

  it('rend une phrase française affichable pour chaque statut', () => {
    for (const statut of STATUTS) {
      const raison = raisonEchecIa(statut);
      expect(raison.trim().length, `statut ${String(statut)}`).toBeGreaterThan(20);
      // Meme exigence que `attendreMessageFrancaisLisible` cote API : une phrase,
      // pas un code d'erreur recopie.
      expect(raison.trimEnd()).toMatch(/[.!?»]$/);
      attendreAucuneFuite(raison);
    }
  });

  it('n’incorpore JAMAIS le texte de la bibliothèque', () => {
    // La raison ne prend qu'un statut en entree : il n'existe aucun chemin par
    // lequel un message tiers pourrait y entrer. Ce test le rend explicite —
    // si la signature accueillait un jour un `detail`, il faudrait le relire.
    expect(raisonEchecIa.length).toBe(1);
    for (const statut of [401, 500, null] as const) {
      expect(raisonEchecIa(statut)).not.toContain('sk-ant');
    }
  });

  it('distingue la clé refusée du reste : c’est la seule panne actionnable', () => {
    expect(raisonEchecIa(401)).toContain('ANTHROPIC_API_KEY');
    expect(raisonEchecIa(403)).toContain('ANTHROPIC_API_KEY');
    // Une panne d'Anthropic ne doit surtout pas envoyer l'utilisateur modifier
    // sa configuration : il y perdrait une clé qui marche.
    expect(raisonEchecIa(500)).not.toContain('ANTHROPIC_API_KEY');
    expect(raisonEchecIa(null)).not.toContain('ANTHROPIC_API_KEY');
  });

  it('promet toujours que l’application reste utilisable (mode dégradé, §5)', () => {
    for (const statut of STATUTS) {
      expect(raisonEchecIa(statut)).toContain('reste utilisable');
    }
  });
});

describe('detailEchecPourJournal', () => {
  it('garde le statut et un extrait assaini', () => {
    const ligne = detailEchecPourJournal(429, 'rate_limit_error on /v1/messages');
    expect(ligne).toContain('HTTP 429');
    attendreAucuneFuite(ligne);
  });

  it('dit « réseau » quand il n’y a aucun statut', () => {
    expect(detailEchecPourJournal(null, 'Connection error.')).toContain('réseau');
  });

  it('n’expose aucun secret, quel que soit le message d’origine', () => {
    for (const message of MESSAGES_HOSTILES) {
      attendreAucuneFuite(detailEchecPourJournal(500, message));
      attendreAucuneFuite(detailEchecPourJournal(null, message));
    }
  });
});
