/**
 * Enveloppe `fetch` typee pour dialoguer avec l'API (docs/06-UI-ET-PARCOURS.md).
 *
 * Convention de reponse de l'API :
 *   - succes  : l'objet demande, ou `{ data, meta }` pour une liste ;
 *   - erreur  : `{ erreur: { code, message, champs? } }`, `message` deja en
 *     francais et directement affichable.
 *
 * CLAUDE.md §4 interdit le `catch` silencieux : cette fonction n'avale jamais
 * une erreur, elle la transforme en `ErreurApi` que l'appelant peut afficher
 * telle quelle.
 *
 * DEUX transports, une seule convention d'erreur. `requeteApi` lit du JSON ;
 * `telechargerFichierApi` lit un FLUX BINAIRE — les routes `/documents/…` et
 * `/exports/…` rendent un PDF ou un classeur Excel, jamais du JSON. Le seul
 * point commun est l'echec : quel que soit le transport, une reponse HTTP en
 * erreur porte l'enveloppe `{ erreur: … }`, d'ou `erreurDeReponse` partagee.
 */

export type ChampsEnErreur = Record<string, string>;

type OptionsErreurApi = {
  code: string;
  statut: number;
  champs?: ChampsEnErreur;
};

export class ErreurApi extends Error {
  readonly code: string;
  readonly statut: number;
  readonly champs?: ChampsEnErreur;

  constructor(message: string, options: OptionsErreurApi) {
    super(message);
    this.name = 'ErreurApi';
    this.code = options.code;
    this.statut = options.statut;
    if (options.champs !== undefined) this.champs = options.champs;
  }
}

type EnveloppeErreur = {
  erreur: { code: string; message: string; champs?: ChampsEnErreur };
};

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null;
}

/** Affine une reponse JSON quelconque vers la forme d'erreur attendue, sans jamais supposer. */
function estEnveloppeErreur(valeur: unknown): valeur is EnveloppeErreur {
  if (!estObjet(valeur)) return false;
  const { erreur } = valeur;
  if (!estObjet(erreur)) return false;
  return typeof erreur.code === 'string' && typeof erreur.message === 'string';
}

/** Extrait `champs`, si present et bien forme (paires cle -> message en francais). */
function extraireChamps(erreur: unknown): ChampsEnErreur | undefined {
  if (!estObjet(erreur)) return undefined;
  const { champs } = erreur;
  if (!estObjet(champs)) return undefined;
  const resultat: ChampsEnErreur = {};
  for (const [cle, valeur] of Object.entries(champs)) {
    if (typeof valeur === 'string') resultat[cle] = valeur;
  }
  return resultat;
}

/** Serveur non demarre ou injoignable : l'ecran appelant doit rester utilisable
 * (mode degrade), pas planter silencieusement. */
function erreurReseau(): ErreurApi {
  return new ErreurApi(
    "Impossible de contacter le serveur. Vérifiez que l'API est démarrée (port 3001).",
    { code: 'reseau_indisponible', statut: 0 },
  );
}

/**
 * Traduit une reponse HTTP en echec en `ErreurApi` affichable.
 *
 * Le message du serveur est repris TEL QUEL quand il existe : un 422
 * « Aucun produit actif : l'affichette serait vide… » dit a l'utilisateur quoi
 * faire, la ou « une erreur est survenue » ne dit rien. On ne fabrique un
 * message generique que si le corps n'est pas une enveloppe d'erreur connue.
 */
function erreurDeReponse(corps: unknown, statut: number): ErreurApi {
  if (estEnveloppeErreur(corps)) {
    const champs = extraireChamps(corps.erreur);
    return new ErreurApi(corps.erreur.message, {
      code: corps.erreur.code,
      statut,
      ...(champs !== undefined ? { champs } : {}),
    });
  }
  return new ErreurApi(`Erreur inattendue du serveur (code HTTP ${statut}).`, {
    code: 'erreur_inattendue',
    statut,
  });
}

/**
 * Appelle `/api{chemin}` et rend la reponse typee `T`. Leve toujours une
 * `ErreurApi` en cas d'echec HTTP ou reseau — jamais de valeur de repli
 * silencieuse.
 *
 * L'en-tete `Content-Type: application/json` n'est pose QUE si un `body` est
 * fourni. Fastify refuse un corps vide annonce comme JSON avec
 * `FST_ERR_CTP_EMPTY_JSON_BODY` (HTTP 400) — c'est le defaut qui a rendu
 * « Valider la commande » impossible (G3, docs/14) : ce POST n'a pas de
 * corps, mais recevait quand meme l'en-tete. La regle vaut pour TOUT appel
 * sans corps, present ou futur, pas seulement celui-la — voir `api.test.ts`.
 */
export async function requeteApi<T>(chemin: string, options: RequestInit = {}): Promise<T> {
  let reponse: Response;
  try {
    reponse = await fetch(`/api${chemin}`, {
      ...options,
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw erreurReseau();
  }

  const corps: unknown = await reponse.json().catch(() => null);

  if (!reponse.ok) throw erreurDeReponse(corps, reponse.status);

  return corps as T;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Documents — transport binaire
   ═══════════════════════════════════════════════════════════════════════════ */

export type FichierRecu = {
  readonly contenu: Blob;
  /** Nom donne par le serveur, deja horodate et versionne (D-026). */
  readonly nomFichier: string;
};

/**
 * Extensions de repli, uniquement si le serveur omettait `Content-Disposition`.
 * Un fichier sans extension sous Windows ne s'ouvre avec RIEN — un repli muet
 * couterait plus cher a l'utilisateur que la ligne qui l'evite.
 */
const EXTENSION_PAR_TYPE_MIME: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

/**
 * Lit le nom de fichier dans l'en-tete `Content-Disposition`.
 *
 * C'est le SERVEUR qui nomme le document, jamais l'interface : le nom porte le
 * numero de version et l'horodatage de l'archivage (D-026,
 * `registre_afsca_2026-06_v1_20260728-2033.pdf`). Le reconstruire ici
 * produirait un nom qui ne correspond a aucune ligne de `document_genere`,
 * donc a rien de verifiable devant un controle.
 *
 * Les deux formes de la RFC 6266 sont acceptees. Le serveur n'emet aujourd'hui
 * que la forme simple, mais lire `filename*` coute trois lignes et evite un nom
 * casse le jour ou un accent apparaitrait dans un libelle de document.
 *
 * Exportee pour etre testee : c'est la seule partie purement calculatoire de la
 * chaine de telechargement.
 */
export function nomFichierDepuisEnTete(entete: string | null): string | null {
  if (entete === null) return null;

  const etendu = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(entete)?.[1];
  if (etendu !== undefined) {
    try {
      const nom = nettoyerNomFichier(decodeURIComponent(etendu));
      if (nom !== null) return nom;
    } catch {
      // Sequence de pourcentage invalide : on retombe sur `filename` simple
      // plutot que de propager une erreur d'analyse d'en-tete a l'utilisateur.
    }
  }

  /* `[^"]*` et non `[^"]+` : sans l'etoile, un `filename=""` ne correspondait a
     rien ici et tombait dans la forme SANS guillemets ci-dessous, qui rendait
     alors la chaine `""` — un nom de fichier fait de deux guillemets. */
  const guillemets = /filename\s*=\s*"([^"]*)"/i.exec(entete)?.[1];
  if (guillemets !== undefined) return nettoyerNomFichier(guillemets);

  const nu = /filename\s*=\s*([^;]+)/i.exec(entete)?.[1];
  if (nu !== undefined) return nettoyerNomFichier(nu);

  return null;
}

/**
 * Ne garde que le dernier segment du chemin. Un `Content-Disposition` qui
 * contiendrait `../` viendrait certes de notre propre serveur, mais un nom de
 * telechargement n'a aucune raison de porter un chemin : on le refuse par
 * principe plutot que par confiance.
 */
function nettoyerNomFichier(brut: string): string | null {
  const segments = brut.trim().split(/[\\/]/);
  const dernier = segments[segments.length - 1]?.trim() ?? '';
  return dernier === '' || dernier === '.' || dernier === '..' ? null : dernier;
}

/**
 * Telecharge un document produit par l'API (`/documents/…` en PDF,
 * `/exports/…` en Excel) et rend son contenu binaire avec le nom donne par le
 * serveur.
 *
 * ATTENTION D-026 : chaque appel ARCHIVE une nouvelle version numerotee du
 * document, avec son empreinte SHA-256. Appeler cette fonction n'est donc pas
 * une lecture — c'est une ECRITURE. Tout appelant doit se rendre inerte le
 * temps de la reponse, sinon un double-clic archive deux versions.
 */
export async function telechargerFichierApi(chemin: string): Promise<FichierRecu> {
  let reponse: Response;
  try {
    reponse = await fetch(`/api${chemin}`, { headers: { Accept: '*/*' } });
  } catch {
    throw erreurReseau();
  }

  if (!reponse.ok) {
    // L'echec, lui, reste du JSON : c'est la seule branche ou lire le corps en
    // JSON a un sens. Sur le chemin nominal on ne touche jamais au flux.
    const corps: unknown = await reponse.json().catch(() => null);
    throw erreurDeReponse(corps, reponse.status);
  }

  const contenu = await reponse.blob();
  const nomServeur = nomFichierDepuisEnTete(reponse.headers.get('Content-Disposition'));
  if (nomServeur !== null) return { contenu, nomFichier: nomServeur };

  const extension = EXTENSION_PAR_TYPE_MIME[contenu.type];
  return { contenu, nomFichier: extension === undefined ? 'document' : `document.${extension}` };
}
