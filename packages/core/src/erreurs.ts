/**
 * Erreurs metier typees. CLAUDE.md §4 : jamais de `catch` silencieux, et un
 * message en francais directement affichable par l'interface.
 *
 * Convention de reponse HTTP (docs/06-UI-ET-PARCOURS.md) :
 *   { erreur: { code, message, champs? } }
 * avec 422 pour une violation de regle metier.
 */

/** Champs fautifs d'une saisie : nom du champ -> raison en francais. */
export type ChampsEnErreur = Record<string, string>;

export class ErreurMetier extends Error {
  readonly code: string;
  readonly statut: number;
  readonly champs?: ChampsEnErreur;

  constructor(
    code: string,
    message: string,
    options: { statut?: number; champs?: ChampsEnErreur; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ErreurMetier';
    this.code = code;
    // 422 par defaut : la requete est bien formee mais viole une regle metier.
    this.statut = options.statut ?? 422;
    if (options.champs !== undefined) this.champs = options.champs;
  }

  /** Forme serialisable, telle qu'attendue par l'interface. */
  versReponse(): { erreur: { code: string; message: string; champs?: ChampsEnErreur } } {
    return {
      erreur: {
        code: this.code,
        message: this.message,
        ...(this.champs === undefined ? {} : { champs: this.champs }),
      },
    };
  }
}

export function estErreurMetier(valeur: unknown): valeur is ErreurMetier {
  return valeur instanceof ErreurMetier;
}

/** Ressource demandee inexistante. */
export class ErreurIntrouvable extends ErreurMetier {
  constructor(quoi: string, identifiant?: string) {
    super(
      'introuvable',
      identifiant === undefined ? `${quoi} introuvable.` : `${quoi} introuvable : ${identifiant}.`,
      { statut: 404 },
    );
    this.name = 'ErreurIntrouvable';
  }
}

/**
 * Parametre absent de la table `parametre`. Erreur volontairement bruyante :
 * CLAUDE.md §7 interdit de coder en dur un seuil, donc l'absence d'un parametre
 * est un defaut de configuration a corriger, pas un cas a contourner par une
 * valeur de repli silencieuse.
 */
export class ErreurParametreManquant extends ErreurMetier {
  constructor(cle: string) {
    super(
      'parametre_manquant',
      `Le paramètre « ${cle} » n'est pas défini. Renseignez-le dans Paramètres avant de continuer.`,
      { statut: 500 },
    );
    this.name = 'ErreurParametreManquant';
  }
}
