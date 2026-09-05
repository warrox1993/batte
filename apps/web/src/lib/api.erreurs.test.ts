/**
 * `lib/api.ts` — la SEULE porte réseau de l'application, côté ÉCHECS.
 *
 * ═══ Ce que ce fichier ajoute à `api.test.ts` ═══
 *
 * `api.test.ts`, à côté, reste valable et n'est pas touché : il prouve le
 * chemin NOMINAL et la règle `Content-Type` (le défaut G3 qui rendait
 * « Valider la commande » impossible). Il s'arrête là où l'API se comporte
 * bien.
 *
 * Ce fichier prend l'autre moitié : ce que l'écran affiche quand elle se
 * comporte MAL. Il n'y a que deux `fetch` dans tout le dépôt, et rien d'autre
 * nulle part — donc tout ce qui remonte à l'utilisateur en cas de panne passe
 * par les quelques lignes testées ici. Une forme inattendue avalée en silence
 * n'y produit pas un bug local : elle produit un écran d'erreur MUET, sur
 * n'importe lequel des trente écrans.
 *
 * C'est le pire cas possible, et c'est celui que ce fichier vise en premier :
 * chaque test vérifie qu'il reste une phrase NON VIDE et un `statut` exact.
 * « L'application ne dit rien » est indébuggable pour le porteur ; « Erreur
 * inattendue du serveur (code HTTP 502) » se transmet au téléphone.
 *
 * ═══ Ce que ce fichier ne prouve pas ═══
 *
 * Que la vraie API émette bien l'enveloppe `{ erreur: { code, message } }` :
 * `fetch` est simulé de bout en bout, aucune requête ne part. Le contrat côté
 * serveur se prouve dans `apps/api`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErreurApi, nomFichierDepuisEnTete, requeteApi, telechargerFichierApi } from './api';

/**
 * Réponse simulée pour le transport JSON.
 *
 * `corpsIllisible` reproduit le cas RÉEL qui manquait : un serveur qui répond
 * en HTML (page d'erreur d'un proxy, 502 de Vite) ou avec un corps vide. Le
 * vrai `Response.json()` REJETTE alors, et c'est cette rejection — non pas un
 * `null` poli — que le code doit encaisser.
 */
function reponseJson(corps: unknown, statut = 200): Response {
  return {
    ok: statut >= 200 && statut < 300,
    status: statut,
    json: () => Promise.resolve(corps),
  } as Response;
}

function reponseCorpsIllisible(statut: number): Response {
  return {
    ok: statut >= 200 && statut < 300,
    status: statut,
    json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
  } as Response;
}

function reponseFichier(options: {
  contenu: Blob;
  contentDisposition?: string;
  statut?: number;
}): Response {
  const statut = options.statut ?? 200;
  return {
    ok: statut >= 200 && statut < 300,
    status: statut,
    headers: {
      get: (nom: string) =>
        nom.toLowerCase() === 'content-disposition' ? (options.contentDisposition ?? null) : null,
    },
    blob: () => Promise.resolve(options.contenu),
    json: () => Promise.reject(new SyntaxError('binaire, pas du JSON')),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requeteApi — l’enveloppe d’erreur `{ erreur: { code, message, champs } }`', () => {
  it('reprend le message du serveur TEL QUEL, avec son code et son statut', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        reponseJson(
          {
            erreur: {
              code: 'reception_deja_consommee',
              message: 'Farine T55 : il ne reste que 200 g sur ce lot, pour une entrée de 500 g.',
            },
          },
          409,
        ),
      ),
    );

    const echec = await requeteApi('/mouvements/abc/annuler').catch((e: unknown) => e);
    expect(echec).toBeInstanceOf(ErreurApi);
    expect(echec).toMatchObject({
      code: 'reception_deja_consommee',
      statut: 409,
      message: 'Farine T55 : il ne reste que 200 g sur ce lot, pour une entrée de 500 g.',
    });
  });

  it('transporte `champs` jusqu’à l’écran (c’est ce qui souligne le bon champ du formulaire)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        reponseJson(
          {
            erreur: {
              code: 'validation',
              message: 'Saisie invalide.',
              champs: { densite: 'La densité doit être un nombre.', nom: 'Nom déjà utilisé.' },
            },
          },
          400,
        ),
      ),
    );

    const echec = (await requeteApi('/ingredients').catch((e: unknown) => e)) as ErreurApi;
    expect(echec.champs).toEqual({
      densite: 'La densité doit être un nombre.',
      nom: 'Nom déjà utilisé.',
    });
  });

  it('écarte les entrées de `champs` qui ne sont pas des chaînes, sans jeter les bonnes', async () => {
    // Un `champs` mal formé ne doit ni faire tomber l'écran, ni empoisonner le
    // formulaire avec un `[object Object]` sous un champ.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        reponseJson(
          {
            erreur: {
              code: 'validation',
              message: 'Saisie invalide.',
              champs: { bon: 'Message correct.', mauvais: { imbrique: true }, nombre: 42 },
            },
          },
          422,
        ),
      ),
    );

    const echec = (await requeteApi('/produits').catch((e: unknown) => e)) as ErreurApi;
    expect(echec.champs).toEqual({ bon: 'Message correct.' });
  });

  it('n’expose PAS `champs` quand le serveur n’en envoie pas', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          reponseJson({ erreur: { code: 'introuvable', message: 'Recette inconnue.' } }, 404),
        ),
    );

    const echec = (await requeteApi('/recettes/zzz').catch((e: unknown) => e)) as ErreurApi;
    expect(echec.champs).toBeUndefined();
  });
});

describe('requeteApi — les corps qui ne sont PAS l’enveloppe attendue (le pire cas)', () => {
  /**
   * Chacun de ces corps a été choisi pour casser une hypothèse différente de
   * `estEnveloppeErreur`. Le test unique est toujours le même, et c'est le
   * seul qui compte pour l'utilisateur : **une phrase non vide, et le code
   * HTTP dedans**.
   */
  const corpsHostiles: ReadonlyArray<readonly [string, unknown]> = [
    ['un corps `null` (204, corps vide, réponse tronquée)', null],
    ['une enveloppe SANS `erreur`', { message: 'oups' }],
    ['`erreur` qui est une CHAÎNE et non un objet', { erreur: 'boom' }],
    ['`erreur` qui est `null` (le piège de `typeof null === "object"`)', { erreur: null }],
    ['`erreur` sans `message`', { erreur: { code: 'x' } }],
    ['`erreur` sans `code`', { erreur: { message: 'Un message orphelin.' } }],
    ['`message` qui n’est pas une chaîne', { erreur: { code: 'x', message: { fr: 'oups' } } }],
    ['un tableau à la racine', [{ erreur: { code: 'x', message: 'y' } }]],
    ['une chaîne nue', 'Internal Server Error'],
    ['un nombre nu', 500],
  ];

  it.each(corpsHostiles)(
    '%s → un message ACTIONNABLE, jamais une erreur muette',
    async (_, corps) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponseJson(corps, 502)));

      const echec = (await requeteApi('/tableau-de-bord').catch((e: unknown) => e)) as ErreurApi;

      expect(echec).toBeInstanceOf(ErreurApi);
      // LE point du fichier : jamais de chaîne vide. Un encart d'erreur sans
      // texte est indistinguable d'un encart qui a réussi à ne rien afficher.
      expect(echec.message.trim().length).toBeGreaterThan(0);
      // Et le code HTTP y figure : c'est le seul indice transmissible par
      // téléphone quand le porteur appelle.
      expect(echec.message).toContain('502');
      expect(echec.statut).toBe(502);
      expect(echec.code).toBe('erreur_inattendue');
    },
  );

  it('un corps qui n’est même pas du JSON (page HTML d’un proxy) reste affichable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponseCorpsIllisible(500)));

    const echec = (await requeteApi('/stock').catch((e: unknown) => e)) as ErreurApi;
    expect(echec).toBeInstanceOf(ErreurApi);
    expect(echec.message).toContain('500');
    // La `SyntaxError` de l'analyse JSON ne doit JAMAIS remonter telle quelle :
    // « Unexpected token < » n'apprend rien au porteur.
    expect(echec.message).not.toContain('Unexpected token');
  });

  it('une panne réseau donne un message qui dit QUOI FAIRE, et le statut 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const echec = (await requeteApi('/stock').catch((e: unknown) => e)) as ErreurApi;
    expect(echec.statut).toBe(0);
    expect(echec.code).toBe('reseau_indisponible');
    expect(echec.message).toContain('3001');
  });

  it('un 204 sans corps se résout sans lever — les mutations qui n’ont rien à rendre', async () => {
    // Caractérisation, pas exigence : quatre routes de l'API répondent 204
    // (`/sessions/:id/rattacher-evenement`, `/opportunites/:id/rejeter`…) et
    // tous leurs appelants ignorent la valeur rendue. `reponse.json()` rejette
    // sur un corps vide, le `.catch(() => null)` l'absorbe, et l'appel se
    // résout à `null`. Ce test FIGE ce comportement : si un jour un écran se
    // met à lire le résultat d'un 204, c'est ici qu'on verra que la promesse
    // ne tient pas ce que son type `Promise<T>` annonce.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponseCorpsIllisible(204)));

    await expect(requeteApi('/opportunites/abc/rejeter', { method: 'POST' })).resolves.toBeNull();
  });
});

describe('nomFichierDepuisEnTete — c’est le SERVEUR qui nomme le document (D-026)', () => {
  it('lit la forme simple, avec et sans guillemets', () => {
    expect(
      nomFichierDepuisEnTete('attachment; filename="registre_afsca_2026-06_v1_20260728-2033.pdf"'),
    ).toBe('registre_afsca_2026-06_v1_20260728-2033.pdf');
    expect(nomFichierDepuisEnTete('attachment; filename=export_stock.xlsx')).toBe(
      'export_stock.xlsx',
    );
  });

  it('préfère `filename*` (RFC 6266) quand les deux formes coexistent', () => {
    // Le jour où un accent apparaît dans un libellé de document, c'est la
    // forme étendue qui porte le nom juste.
    const entete =
      'attachment; filename="fiche.pdf"; filename*=UTF-8\'\'fiche_recette_cr%C3%AApe.pdf';
    expect(nomFichierDepuisEnTete(entete)).toBe('fiche_recette_crêpe.pdf');
  });

  it('retombe sur `filename` quand `filename*` est mal encodé, au lieu de propager l’erreur', () => {
    // `decodeURIComponent('%ZZ')` lève : un en-tête abîmé ne doit pas faire
    // échouer un téléchargement qui a par ailleurs réussi.
    const entete = 'attachment; filename="repli.pdf"; filename*=UTF-8\'\'%ZZ';
    expect(nomFichierDepuisEnTete(entete)).toBe('repli.pdf');
  });

  it('refuse tout chemin : seul le dernier segment survit', () => {
    // Le nom vient de notre propre serveur, mais un nom de téléchargement n'a
    // aucune raison de porter un chemin — on le refuse par principe.
    expect(nomFichierDepuisEnTete('attachment; filename="../../etc/passwd"')).toBe('passwd');
    expect(nomFichierDepuisEnTete('attachment; filename="C:\\Windows\\notes.pdf"')).toBe(
      'notes.pdf',
    );
    expect(nomFichierDepuisEnTete("attachment; filename*=UTF-8''..%2F..%2Fsecret.pdf")).toBe(
      'secret.pdf',
    );
  });

  const enteteSansNomUtilisable: ReadonlyArray<readonly [string, string | null]> = [
    ['en-tête absent', null],
    ['aucun `filename`', 'attachment'],
    ['`filename` vide entre guillemets', 'attachment; filename=""'],
    ['`filename` fait d’espaces', 'attachment; filename="   "'],
    ['`filename` réduit à un point', 'attachment; filename="."'],
    ['`filename` réduit à deux points', 'attachment; filename=".."'],
    ['un chemin qui se termine par un séparateur', 'attachment; filename="dossier/"'],
  ];

  it.each(enteteSansNomUtilisable)('%s → `null`, pour laisser jouer le repli', (_, entete) => {
    // `filename=""` est le cas qui rendait littéralement `""` — un fichier
    // nommé de deux guillemets, que Windows n'ouvre avec rien.
    expect(nomFichierDepuisEnTete(entete)).toBeNull();
  });

  it('accepte la casse et les espaces que les serveurs se permettent', () => {
    expect(nomFichierDepuisEnTete('ATTACHMENT; FILENAME = "bilan.xlsx"')).toBe('bilan.xlsx');
    expect(nomFichierDepuisEnTete('inline; filename=note.pdf; size=1024')).toBe('note.pdf');
  });
});

describe('telechargerFichierApi — le transport binaire (chaque appel ARCHIVE, D-026)', () => {
  it('rend le contenu et le nom DONNÉ PAR LE SERVEUR', async () => {
    const contenu = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        reponseFichier({
          contenu,
          contentDisposition: 'attachment; filename="registre_afsca_2026-06_v1.pdf"',
        }),
      ),
    );

    const recu = await telechargerFichierApi('/documents/registre-afsca');
    // Reconstruire le nom ici produirait un nom qui ne correspond à aucune
    // ligne de `document_genere`, donc à rien de vérifiable en contrôle AFSCA.
    expect(recu.nomFichier).toBe('registre_afsca_2026-06_v1.pdf');
    expect(recu.contenu).toBe(contenu);
  });

  it('donne une extension de repli d’après le type MIME quand le serveur ne nomme rien', async () => {
    // Un fichier sans extension ne s'ouvre avec RIEN sous Windows.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          reponseFichier({ contenu: new Blob(['x'], { type: 'application/pdf' }) }),
        ),
    );
    await expect(telechargerFichierApi('/documents/x')).resolves.toMatchObject({
      nomFichier: 'document.pdf',
    });

    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        reponseFichier({
          contenu: new Blob(['x'], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }),
        }),
      ),
    );
    await expect(telechargerFichierApi('/exports/stock')).resolves.toMatchObject({
      nomFichier: 'document.xlsx',
    });
  });

  it('se rabat sur « document » nu pour un type MIME inconnu, sans jamais lever', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          reponseFichier({ contenu: new Blob(['x'], { type: 'application/octet-stream' }) }),
        ),
    );
    await expect(telechargerFichierApi('/documents/inconnu')).resolves.toMatchObject({
      nomFichier: 'document',
    });
  });

  it('sur un échec HTTP, lit l’enveloppe JSON — même convention que `requeteApi`', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        reponseJson(
          {
            erreur: {
              code: 'aucun_produit_actif',
              message: "Aucun produit actif : l'affichette serait vide.",
            },
          },
          422,
        ),
      ),
    );

    const echec = (await telechargerFichierApi('/documents/affichette').catch(
      (e: unknown) => e,
    )) as ErreurApi;
    expect(echec).toBeInstanceOf(ErreurApi);
    expect(echec.statut).toBe(422);
    expect(echec.message).toContain("l'affichette serait vide");
  });

  it('sur un échec dont le corps n’est pas du JSON, reste affichable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponseCorpsIllisible(503)));

    const echec = (await telechargerFichierApi('/exports/stock').catch(
      (e: unknown) => e,
    )) as ErreurApi;
    expect(echec.message).toContain('503');
    expect(echec.message.trim().length).toBeGreaterThan(0);
  });

  it('sur une coupure réseau, rend la MÊME erreur que `requeteApi` (une seule convention)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const echec = (await telechargerFichierApi('/documents/x').catch(
      (e: unknown) => e,
    )) as ErreurApi;
    expect(echec.code).toBe('reseau_indisponible');
    expect(echec.statut).toBe(0);
  });

  it('n’appelle QU’UNE fois `fetch`, et sur le chemin `/api` préfixé', async () => {
    const fetchSimule = vi
      .fn()
      .mockResolvedValue(reponseFichier({ contenu: new Blob(['x'], { type: 'application/pdf' }) }));
    vi.stubGlobal('fetch', fetchSimule);

    await telechargerFichierApi('/documents/registre-afsca');

    // Chaque appel archive une version numérotée : un appel dupliqué dans le
    // transport lui-même produirait deux lignes de `document_genere` pour un
    // seul geste de l'utilisateur.
    expect(fetchSimule).toHaveBeenCalledTimes(1);
    expect(fetchSimule.mock.calls[0]?.[0]).toBe('/api/documents/registre-afsca');
  });
});
