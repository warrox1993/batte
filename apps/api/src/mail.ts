/**
 * Envoi de mail (Nodemailer + SMTP), avec MODE TEST par defaut.
 *
 * D-008 (docs/05-DECISIONS.md) : SMTP simple, pas l'API Gmail en V1. Le mode
 * test est le comportement PAR DEFAUT et non une option a activer : envoyer un
 * vrai mail chez un fournisseur doit etre un acte DELIBERE, jamais l'effet de
 * bord d'une variable d'environnement oubliee dans `.env` (docs/04-ROADMAP-LOTS,
 * Lot 7 — « prevoir un mode test qui ecrit le mail dans un fichier »).
 *
 * `MAIL_MODE_TEST=false` est donc la SEULE facon d'envoyer un vrai mail — et
 * c'est un choix explicite du porteur, pas une absence de configuration.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import { ErreurMetier, formaterDateHeure, horodatageFichier, maintenantUtc } from '@batte/core';
import { config } from '@batte/db';

export type PieceJointeMail = {
  readonly nomFichier: string;
  readonly chemin: string;
};

export type MessageMail = {
  readonly destinataire: string;
  readonly sujet: string;
  readonly corpsTexte: string;
  readonly piecesJointes?: readonly PieceJointeMail[];
};

export type ResultatEnvoiMail = {
  /** Vrai si le mail a ete ECRIT DANS UN FICHIER plutot qu'envoye reellement. */
  readonly modeTest: boolean;
  /** Chemin du fichier ecrit, uniquement en mode test. */
  readonly cheminFichierTest: string | null;
  readonly dateEnvoi: string;
};

function texteEnv(cle: string): string {
  return process.env[cle] ?? '';
}

/**
 * Neutralise les retours a la ligne d'une valeur destinee a un en-tete de mail.
 *
 * Un nom de fournisseur est saisi a la main et se retrouve tel quel dans le
 * sujet ; une adresse peut venir de la fiche fournisseur sans repasser par le
 * `z.email()` de la route. Un `\r\n` y ouvrirait un en-tete supplementaire
 * (`Bcc:`, `Content-Type:`…) dans le message SMTP.
 *
 * Nodemailer applique deja exactement cette substitution avant d'encoder un
 * en-tete (`mime-node/_encodeHeaderValue`), donc l'envoi REEL n'a jamais ete
 * vulnerable. On la reproduit ici pour que le MODE TEST archive precisement ce
 * qui serait parti : sans cela, le fichier de `sorties/mails/` affichait des
 * lignes « Sujet : » forgees que le vrai mail n'aurait jamais portees — un
 * mode test qui ment sur ce qu'il simule ne vaut rien.
 */
function normaliserEnTete(valeur: string): string {
  return valeur.replace(/\r?\n|\r/g, ' ').trim();
}

/**
 * Mode test actif tant que `MAIL_MODE_TEST` n'est pas EXPLICITEMENT `false`.
 * Une variable absente, vide, ou mal orthographiee reste donc du cote sur —
 * jamais du cote « envoie un vrai mail ».
 */
function estModeTest(): boolean {
  const brut = texteEnv('MAIL_MODE_TEST');
  return brut === '' ? true : brut.trim().toLowerCase() !== 'false';
}

function creerTransporteur(): Transporter {
  const hote = texteEnv('SMTP_HOTE');
  if (hote === '') {
    throw new ErreurMetier(
      'smtp_non_configure',
      "Aucun serveur SMTP n'est configuré (SMTP_HOTE manquant dans .env). Renseignez-le, " +
        'ou laissez MAIL_MODE_TEST=true pour continuer à travailler sans envoi réel.',
      { statut: 500 },
    );
  }

  const portBrut = texteEnv('SMTP_PORT');
  const port = portBrut === '' ? 587 : Number.parseInt(portBrut, 10);
  if (!Number.isInteger(port)) {
    // La valeur lue n'est PAS recopiee dans le message : aucune valeur
    // d'environnement ne franchit la frontiere HTTP (CLAUDE.md §2 et §7).
    // Nommer la variable suffit — l'utilisateur ouvre son `.env` et voit.
    throw new ErreurMetier(
      'smtp_port_invalide',
      "SMTP_PORT, dans le fichier .env du poste, n'est pas un nombre entier. " +
        'Corrigez-le (587 par défaut) ou laissez-le vide.',
      { statut: 500 },
    );
  }

  return nodemailer.createTransport({
    host: hote,
    port,
    // Convention SMTP usuelle : le port 465 est le seul a exiger TLS implicite
    // (SMTPS) ; les autres (587, 25…) negocient STARTTLS en clair d'abord.
    secure: port === 465,
    auth: {
      user: texteEnv('SMTP_UTILISATEUR'),
      pass: texteEnv('SMTP_MOT_DE_PASSE'),
    },
  });
}

/** Ecrit le mail dans un fichier du dossier de sorties, au lieu de l'envoyer. */
function ecrireMailDeTest(message: MessageMail): string {
  const dossier = join(config.dossierSorties, 'mails');
  mkdirSync(dossier, { recursive: true });

  const cible = message.destinataire.replace(/[^a-zA-Z0-9@.-]/g, '_');
  const chemin = join(dossier, `mail_${horodatageFichier()}_${cible}.txt`);

  const piecesJointes = message.piecesJointes ?? [];
  const lignesPieces =
    piecesJointes.length === 0
      ? 'Pièces jointes : aucune'
      : `Pièces jointes :\n${piecesJointes.map((p) => `  - ${p.nomFichier} (${p.chemin})`).join('\n')}`;

  writeFileSync(
    chemin,
    [
      "[MODE TEST — ce mail n'a PAS été envoyé, il est archivé ici]",
      `À : ${message.destinataire}`,
      `Sujet : ${message.sujet}`,
      `Date : ${formaterDateHeure(new Date())}`,
      '',
      message.corpsTexte,
      '',
      lignesPieces,
      '',
    ].join('\n'),
    'utf-8',
  );

  return chemin;
}

/**
 * Envoie un mail — ou l'ecrit dans un fichier en mode test (le defaut).
 *
 * Ne verifie PAS que le destinataire est configure : c'est la responsabilite
 * de l'appelant (la route sait, elle, si l'adresse vient d'une saisie ou d'un
 * repli sur la fiche fournisseur) de refuser une adresse absente avec un
 * message qui nomme le fournisseur en cause.
 */
export async function envoyerMail(message: MessageMail): Promise<ResultatEnvoiMail> {
  if (message.destinataire.trim() === '') {
    throw new ErreurMetier(
      'destinataire_manquant',
      "Impossible d'envoyer ce mail : aucune adresse de destination n'a été fournie.",
    );
  }

  // Les deux valeurs qui deviennent des EN-TETES sont normalisees une seule
  // fois, ici, pour que le mode test et l'envoi reel voient exactement le meme
  // message. Le corps, lui, est un contenu : ses retours a la ligne sont utiles.
  const messageSur: MessageMail = {
    ...message,
    destinataire: normaliserEnTete(message.destinataire),
    sujet: normaliserEnTete(message.sujet),
  };

  if (estModeTest()) {
    const cheminFichierTest = ecrireMailDeTest(messageSur);
    return { modeTest: true, cheminFichierTest, dateEnvoi: maintenantUtc() };
  }

  const transporteur = creerTransporteur();
  const expediteur = normaliserEnTete(texteEnv('SMTP_EXPEDITEUR') || texteEnv('SMTP_UTILISATEUR'));

  await transporteur.sendMail({
    from: expediteur,
    to: messageSur.destinataire,
    subject: messageSur.sujet,
    text: messageSur.corpsTexte,
    attachments: (messageSur.piecesJointes ?? []).map((p) => ({
      filename: p.nomFichier,
      path: p.chemin,
    })),
  });

  return { modeTest: false, cheminFichierTest: null, dateEnvoi: maintenantUtc() };
}
