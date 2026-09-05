import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErreurApi, requeteApi } from './api';

/**
 * G3 (docs/14-TEST-PARCOURS-UTILISATEUR.md) : `requeteApi` posait
 * `Content-Type: application/json` sur TOUTES les requetes, y compris celles
 * sans `body`. Fastify refuse alors un corps vide annonce comme JSON
 * (`FST_ERR_CTP_EMPTY_JSON_BODY`, HTTP 400) — c'est ce qui rendait « Valider
 * la commande » impossible.
 *
 * Le test ci-dessous verifie la regle au niveau de `requeteApi` lui-meme, et
 * non au niveau d'un seul appelant (`validerCommandeSelectionnee` dans
 * `Achats.tsx`) : n'importe quel futur appel POST/PATCH sans corps doit rester
 * protege, meme si le testeur ne l'a pas encore rencontre.
 *
 * `fetch` est simule ici : aucune requete reseau reelle. Ce fichier vit sous
 * `apps/web/src`, il tourne donc dans le projet `web` de `vitest.config.ts`
 * (environnement `jsdom`) — mais il n'a besoin d'aucun DOM : il teste une
 * fonction de transport, pas un composant.
 */

function reponseFausse(corps: unknown, statut = 200): Response {
  return {
    ok: statut >= 200 && statut < 300,
    status: statut,
    json: () => Promise.resolve(corps),
  } as Response;
}

describe('requeteApi — en-tete Content-Type', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ne pose PAS Content-Type quand la requete n a pas de corps (cas « Valider »)', async () => {
    const fetchSimule = vi.fn().mockResolvedValue(reponseFausse({ ok: true }));
    vi.stubGlobal('fetch', fetchSimule);

    await requeteApi('/commandes/abc/valider', { method: 'POST' });

    const [, init] = fetchSimule.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('Content-Type');
  });

  it('ne pose pas Content-Type sur une lecture GET sans options', async () => {
    const fetchSimule = vi.fn().mockResolvedValue(reponseFausse({ data: [] }));
    vi.stubGlobal('fetch', fetchSimule);

    await requeteApi('/stock');

    const [, init] = fetchSimule.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('Content-Type');
  });

  it('pose Content-Type quand un corps JSON est fourni', async () => {
    const fetchSimule = vi.fn().mockResolvedValue(reponseFausse({ ok: true }));
    vi.stubGlobal('fetch', fetchSimule);

    await requeteApi('/commandes/generer', {
      method: 'POST',
      body: JSON.stringify({ notes: 'test' }),
    });

    const [, init] = fetchSimule.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('une chaine vide reste un corps : Content-Type reste pose', async () => {
    // `body: ''` est un choix explicite de l'appelant, distinct de « pas de
    // corps du tout ». La regle porte sur `undefined`, pas sur la valeur.
    const fetchSimule = vi.fn().mockResolvedValue(reponseFausse({ ok: true }));
    vi.stubGlobal('fetch', fetchSimule);

    await requeteApi('/echeances/xyz/marquer-faite', { method: 'POST', body: '' });

    const [, init] = fetchSimule.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('un en-tete explicite de l appelant a priorite sur le defaut', async () => {
    const fetchSimule = vi.fn().mockResolvedValue(reponseFausse({ ok: true }));
    vi.stubGlobal('fetch', fetchSimule);

    await requeteApi('/exemple', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/vnd.custom+json' },
    });

    const [, init] = fetchSimule.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/vnd.custom+json' });
  });
});

describe('requeteApi — transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rend le corps typé sur un succès', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reponseFausse({ valeur: 42 })));
    const resultat = await requeteApi<{ valeur: number }>('/stock');
    expect(resultat).toEqual({ valeur: 42 });
  });

  it('traduit un échec HTTP en ErreurApi avec le message du serveur', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          reponseFausse(
            { erreur: { code: 'aucun_produit_actif', message: 'Aucun produit actif.' } },
            422,
          ),
        ),
    );

    await expect(requeteApi('/affichettes')).rejects.toMatchObject({
      code: 'aucun_produit_actif',
      statut: 422,
      message: 'Aucun produit actif.',
    });
  });

  it('traduit une panne réseau en erreur affichable, jamais en exception brute', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await expect(requeteApi('/stock')).rejects.toBeInstanceOf(ErreurApi);
  });
});
