import { describe, expect, it } from 'vitest';
import { messageEnvoiCommande } from './Achats';

/**
 * Rejeu de parcours du 31/07/2026 (docs/27 §3.a, confirmé encore ouvert par
 * docs/33) — l'unique « impasse silencieuse » relevée : le bloc permanent
 * affiché après l'envoi d'une commande disait toujours « Envoyée à X le
 * date. », que le mail soit parti pour de vrai ou qu'il ait seulement été
 * archivé en MODE TEST (`MAIL_MODE_TEST`, `apps/api/src/mail.ts`) — et cette
 * confusion REVENAIT après un rechargement de page, puisque le mode n'était
 * connu que le temps de la réponse HTTP de l'envoi lui-même.
 *
 * Mission « le seul piège silencieux qui reste » (01/08/2026) : le fait est
 * désormais PERSISTÉ côté serveur (journal d'audit,
 * `packages/db/src/services/commandes.ts::envoiModeTestConnu`) et exposé par
 * `GET /commandes/:id` comme n'importe quel autre champ de la commande — plus
 * de mémoire locale à cet écran à entretenir. `messageEnvoiCommande` est la
 * fonction PURE extraite de ce bloc : ces tests prouvent qu'elle dit le mode
 * test mot pour mot quand il est connu VRAI, qu'un envoi réel connu FAUX se
 * lit sans la moindre ambiguïté, et qu'un fait INCONNU (`null`, commande
 * envoyée avant ce correctif) ne se fait jamais passer pour un envoi réel.
 *
 * Ce que ces tests NE prouvent PAS : que le composant React appelle bien
 * cette fonction avec les bons arguments au bon moment, ni que
 * `GET /commandes/:id` retrouve effectivement ce fait après un rechargement
 * réel du navigateur (aucun test de rendu dans CE fichier : il teste des
 * fonctions pures). Le montage de l'écran vit dans
 * `Achats.montage.test.tsx`, à côté.
 */
function formaterDateTest(iso: string): string {
  // Reproduction minimale de `formaterDate` (@batte/core) : suffisant pour
  // ces tests, qui ne portent pas sur le format de date lui-même.
  return `LE-${iso}`;
}

const COMMANDE_ENVOYEE_MODE_TEST = {
  emailEnvoyeA: 'meunier@example.be',
  dateEnvoi: '2026-08-01',
  envoiModeTest: true,
  cheminFichierTest: 'sorties/mails/mail_20260801-meunier.txt',
};

const COMMANDE_ENVOYEE_REELLE = {
  emailEnvoyeA: 'meunier@example.be',
  dateEnvoi: '2026-08-01',
  envoiModeTest: false,
  cheminFichierTest: null,
};

const COMMANDE_ENVOYEE_INCONNUE = {
  emailEnvoyeA: 'meunier@example.be',
  dateEnvoi: '2026-08-01',
  envoiModeTest: null,
  cheminFichierTest: null,
};

describe('messageEnvoiCommande — le mode test doit apparaître, mot pour mot, en PERMANENCE', () => {
  it("dit qu'aucun envoi n'est enregistré si l'e-mail n'a jamais été renseigné", () => {
    const commande = {
      emailEnvoyeA: null,
      dateEnvoi: null,
      envoiModeTest: null,
      cheminFichierTest: null,
    };
    expect(messageEnvoiCommande(commande, formaterDateTest)).toBe('Aucun envoi enregistré.');
  });

  it(
    'LE DÉFAUT CORRIGÉ : dit explicitement « Mode test » et que rien n’a été ' +
      'envoyé, identiquement juste après l’envoi ET après un rechargement de page ' +
      '(même donnée, `envoiModeTest: true`, dans les deux cas)',
    () => {
      const message = messageEnvoiCommande(COMMANDE_ENVOYEE_MODE_TEST, formaterDateTest);
      expect(message).toContain('Mode test');
      expect(message).toContain("rien n'a été envoyé au fournisseur");
      expect(message).toContain('sorties/mails/mail_20260801-meunier.txt');
      expect(message).toContain('meunier@example.be');
    },
  );

  it('retombe sur un chemin générique si le chemin de fichier test est absent', () => {
    const commande = { ...COMMANDE_ENVOYEE_MODE_TEST, cheminFichierTest: null };
    expect(messageEnvoiCommande(commande, formaterDateTest)).toContain('un fichier local');
  });

  it(
    'LA VÉRIFICATION INVERSE : un envoi RÉEL connu (`envoiModeTest: false`) se ' +
      'lit « Envoyée à... » sans la moindre mention de mode test — jamais un ' +
      'doute remplacé par un autre',
    () => {
      const message = messageEnvoiCommande(COMMANDE_ENVOYEE_REELLE, formaterDateTest);
      expect(message).toBe('Envoyée à meunier@example.be le LE-2026-08-01.');
      expect(message).not.toContain('Mode test');
      expect(message).not.toContain('non retrouvé');
    },
  );

  it("n'affiche pas de date si `dateEnvoi` est absente, sur un envoi réel connu", () => {
    const commande = { ...COMMANDE_ENVOYEE_REELLE, dateEnvoi: null };
    expect(messageEnvoiCommande(commande, formaterDateTest)).toBe('Envoyée à meunier@example.be.');
  });

  it(
    'FAIT INCONNU (`envoiModeTest: null`, commande envoyée avant ce correctif) : ' +
      'ne prétend NI un envoi réel NI un mode test — dit l’incertitude elle-même, ' +
      'jamais `false` par défaut (CLAUDE.md, doctrine « inconnu ≠ zéro »)',
    () => {
      const message = messageEnvoiCommande(COMMANDE_ENVOYEE_INCONNUE, formaterDateTest);
      expect(message).toContain('meunier@example.be');
      expect(message).toContain('non retrouvé');
      expect(message).not.toContain('Mode test');
      // Ne doit pas non plus être l'ANCIEN texte neutre à l'identique : ce
      // serait exactement le défaut d'origine (affirmer un envoi réel qui
      // n'est en fait pas connu).
      expect(message).not.toBe('Envoyée à meunier@example.be le LE-2026-08-01.');
    },
  );
});
