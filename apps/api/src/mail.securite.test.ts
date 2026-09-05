/**
 * La chaine mail, du cote de ce qui SORT.
 *
 * Trois questions, trois reponses figees ici :
 *
 *  1. Les identifiants SMTP peuvent-ils apparaitre quelque part ? Le mot de
 *     passe et l'utilisateur sont poses en sentinelles dans l'environnement du
 *     processus de test : leur presence dans un fichier ecrit ou dans un message
 *     d'erreur est une preuve de fuite.
 *  2. L'adresse ou le sujet peuvent-ils forger un en-tete ? Le nom du
 *     fournisseur est saisi a la main et se retrouve dans le sujet ; un `\r\n`
 *     y ouvrirait un `Bcc:`.
 *  3. Le mode test ecrit-il vraiment un fichier au lieu d'envoyer, et le fait-il
 *     par DEFAUT ? Un mode test qu'il faut penser a activer ne protege personne.
 *
 * Aucun serveur SMTP n'est contacte : `SMTP_HOTE` reste vide, ce qui est
 * precisement l'etat d'un poste qui n'a pas encore configure son mail.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { estErreurMetier } from '@batte/core';
import { config } from '@batte/db';
import { envoyerMail } from './mail.js';

const SENTINELLE_MDP = 'SENTINELLE0SMTP0MOT0DE0PASSE0NE0DOIT0JAMAIS0SORTIR';
const SENTINELLE_UTILISATEUR = 'SENTINELLE0SMTP0UTILISATEUR';
const SENTINELLE_PORT = 'SENTINELLE0SMTP0PORT0PAS0UN0ENTIER';

const envInitial: Record<string, string | undefined> = {};
const fichiersCrees: string[] = [];

function definir(cle: string, valeur: string | undefined): void {
  if (!(cle in envInitial)) envInitial[cle] = process.env[cle];
  if (valeur === undefined) delete process.env[cle];
  else process.env[cle] = valeur;
}

beforeEach(() => {
  // On ne DEFINIT PAS MAIL_MODE_TEST : c'est justement l'absence de reglage
  // qu'on veut voir tomber du bon cote.
  definir('MAIL_MODE_TEST', undefined);
  definir('SMTP_HOTE', undefined);
  definir('SMTP_UTILISATEUR', SENTINELLE_UTILISATEUR);
  definir('SMTP_MOT_DE_PASSE', SENTINELLE_MDP);
  definir('SMTP_EXPEDITEUR', undefined);
  definir('SMTP_PORT', undefined);
});

afterEach(() => {
  for (const [cle, valeur] of Object.entries(envInitial)) {
    if (valeur === undefined) delete process.env[cle];
    else process.env[cle] = valeur;
  }
});

afterAll(() => {
  for (const chemin of fichiersCrees) {
    if (existsSync(chemin)) rmSync(chemin, { force: true });
  }
});

/** Le fichier ecrit par le mode test, lu tel quel. */
async function envoyerEtLire(message: Parameters<typeof envoyerMail>[0]): Promise<{
  chemin: string;
  contenu: string;
}> {
  const resultat = await envoyerMail(message);
  expect(resultat.modeTest).toBe(true);
  expect(resultat.cheminFichierTest).not.toBeNull();
  const chemin = resultat.cheminFichierTest!;
  fichiersCrees.push(chemin);
  return { chemin, contenu: readFileSync(chemin, 'utf-8') };
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. Le mode test est le défaut, et il écrit au lieu d'envoyer
   ═══════════════════════════════════════════════════════════════════════════ */

describe('mode test', () => {
  it('est actif sans aucune variable MAIL_MODE_TEST', async () => {
    const { chemin, contenu } = await envoyerEtLire({
      destinataire: 'meunier@example.invalid',
      sujet: 'Bon de commande CF-2026-0001',
      corpsTexte: 'Bonjour,\n\nMerci de préparer la commande.\n',
    });

    expect(existsSync(chemin)).toBe(true);
    expect(contenu).toContain('MODE TEST');
    expect(contenu).toContain('meunier@example.invalid');
  });

  it('n’écrit AUCUN identifiant SMTP dans le fichier archivé', async () => {
    const { contenu } = await envoyerEtLire({
      destinataire: 'meunier@example.invalid',
      sujet: 'Bon de commande CF-2026-0002',
      corpsTexte: 'Corps sans secret.',
      piecesJointes: [{ nomFichier: 'bon.pdf', chemin: join(config.dossierSorties, 'bon.pdf') }],
    });

    expect(contenu).not.toContain(SENTINELLE_MDP);
    expect(contenu).not.toContain(SENTINELLE_UTILISATEUR);
    expect(contenu).not.toMatch(/sk-ant-/);
  });

  it('range le fichier dans le dossier de sorties, quoi que vaille l’adresse', async () => {
    // Une adresse qui ressemble a un chemin ne doit pas choisir ou l'on ecrit.
    const { chemin } = await envoyerEtLire({
      destinataire: '../../../windows/system32/evil@example.invalid',
      sujet: 'Traversée de chemin',
      corpsTexte: 'x',
    });

    const dossierAttendu = resolve(config.dossierSorties, 'mails');
    expect(resolve(dirname(chemin))).toBe(dossierAttendu);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Injection d'en-tête par une donnée de la base
   ═══════════════════════════════════════════════════════════════════════════ */

describe('injection d’en-tête', () => {
  it('un nom de fournisseur avec saut de ligne ne forge pas de second en-tête', async () => {
    // Le sujet est construit avec `fournisseurNom`, saisi a la main dans la
    // fiche fournisseur (apps/api/src/routes/commandes.ts).
    const { contenu } = await envoyerEtLire({
      destinataire: 'meunier@example.invalid',
      sujet: 'Bon de commande CF-2026-0003 — Moulin\r\nBcc: espion@example.invalid',
      corpsTexte: 'Corps normal.',
    });

    const lignes = contenu.split('\n');
    expect(lignes.filter((l) => l.startsWith('Sujet :'))).toHaveLength(1);
    expect(lignes.some((l) => l.startsWith('Bcc:'))).toBe(false);
    // Le texte n'est pas perdu pour autant : il est aplati, comme le ferait
    // nodemailer avant d'encoder l'en-tete.
    expect(contenu).toContain('Bcc: espion@example.invalid');
  });

  it('une adresse avec saut de ligne ne forge pas de second destinataire', async () => {
    const { contenu } = await envoyerEtLire({
      destinataire: 'meunier@example.invalid\r\nBcc: espion@example.invalid',
      sujet: 'Bon de commande CF-2026-0004',
      corpsTexte: 'Corps normal.',
    });

    const lignes = contenu.split('\n');
    expect(lignes.filter((l) => l.startsWith('À :'))).toHaveLength(1);
    expect(lignes.some((l) => l.startsWith('Bcc:'))).toBe(false);
  });

  it('refuse une adresse vide plutôt que d’envoyer dans le vide', async () => {
    await expect(
      envoyerMail({ destinataire: '   ', sujet: 'x', corpsTexte: 'y' }),
    ).rejects.toSatisfy(estErreurMetier);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Erreurs de configuration : parlantes, sans recopier l'environnement
   ═══════════════════════════════════════════════════════════════════════════ */

describe('erreurs de configuration SMTP', () => {
  it('sans serveur configuré, refuse d’envoyer avec un message actionnable', async () => {
    definir('MAIL_MODE_TEST', 'false');

    const echec = await envoyerMail({
      destinataire: 'meunier@example.invalid',
      sujet: 'x',
      corpsTexte: 'y',
    }).catch((cause: unknown) => cause);

    expect(estErreurMetier(echec)).toBe(true);
    if (estErreurMetier(echec)) {
      expect(echec.code).toBe('smtp_non_configure');
      expect(echec.message).toContain('SMTP_HOTE');
      // Le message NOMME les variables ; il n'en recopie AUCUNE valeur.
      expect(echec.message).not.toContain(SENTINELLE_MDP);
      expect(echec.message).not.toContain(SENTINELLE_UTILISATEUR);
    }
  });

  it('un SMTP_PORT illisible est signalé sans recopier sa valeur', async () => {
    definir('MAIL_MODE_TEST', 'false');
    definir('SMTP_HOTE', 'smtp.invalid');
    definir('SMTP_PORT', SENTINELLE_PORT);

    const echec = await envoyerMail({
      destinataire: 'meunier@example.invalid',
      sujet: 'x',
      corpsTexte: 'y',
    }).catch((cause: unknown) => cause);

    expect(estErreurMetier(echec)).toBe(true);
    if (estErreurMetier(echec)) {
      expect(echec.code).toBe('smtp_port_invalide');
      expect(echec.message).toContain('SMTP_PORT');
      // Aucune valeur d'environnement ne franchit la frontière HTTP : une
      // erreur métier est rendue telle quelle au navigateur.
      expect(echec.message).not.toContain(SENTINELLE_PORT);
    }
  });
});
