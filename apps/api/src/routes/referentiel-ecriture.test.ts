/**
 * Tests des routes d'ecriture du referentiel.
 *
 * CE QUE CE FICHIER PROUVE, et c'est la raison d'etre de tout le lot : la
 * CHAINE de donnees du §0 de CLAUDE.md est refermee. Un ingredient cree chez un
 * fournisseur, avec son conditionnement et son prix, remonte sans ressaisie
 * jusqu'au cout par crepe d'une recette — et un changement de tarif du meunier
 * s'y propage.
 *
 * Deux scenarios portent l'essentiel :
 *  1. **R2 se remplit.** Son cout par crepe vaut `null` (recette vide) et
 *     devient un nombre. C'est le trou de docs/13 §4.7, mesure.
 *  2. **Un tarif change et le cout suit.** Le prix vit dans
 *     `conditionnement.prix_cents` (D-018) ; sans route, il restait fige au prix
 *     de la graine, pour toujours.
 *
 * Le serveur est construit A LA MAIN plutot que par `construireServeur` : ce
 * plugin n'est pas encore enregistre dans `serveur.ts` (c'est un cablage a
 * faire), et un test qui attendrait ce cablage serait vert par absence.
 *
 * Aucune valeur metier n'est figee en dur : les ingredients du scenario sont
 * CREES par le test, jamais empruntes a la graine. Un test qui asserte un
 * chiffre que la graine peut deplacer casse au premier ajustement legitime —
 * ce piege a deja coute plusieurs tests a ce depot.
 */

import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  creerBase,
  migrer,
  schema,
  seed,
  seedDemonstration,
  seedDemonstrationActivite,
  type BaseBatte,
} from '@batte/db';
import type {
  ListeConditionnements,
  ListeIngredientsComplets,
  ListeLieuxComplets,
  ListeRecettes,
  ListeRecettesReferentiel,
  RecetteDetail,
  ResultatVersionRecette,
} from '@batte/core';
/**
 * `seedDemonstrationActivite` n'est appelee que par le point d'entree CLI de
 * `seed/demonstration.ts`, et n'est pas exportee par le barrel `@batte/db` :
 * d'ou l'import relatif, dans un fichier de test ou il ne coute rien. C'est
 * elle qui fait PRODUIRE R1, donc elle qui rend la recette scellee au sens de
 * D-005 — sans elle, le test du scellement serait vert par absence.
 */
import { enregistrerGestionnaireErreurs } from '../plugins/erreurs.js';
import { routesRecettes } from './recettes.js';
import { routesReferentiel } from './referentiel.js';
import { routesReferentielEcriture } from './referentiel-ecriture.js';

type ReponseErreur = {
  erreur: { code: string; message: string; champs?: Record<string, string> };
};

/** Jour civil arbitraire mais COHERENT entre les tests : le tarif doit pouvoir evoluer APRES. */
const JOUR_PRIX_INITIAL = '2026-01-05';
const JOUR_PRIX_SUIVANT = '2026-09-01';

describe('routes d’écriture du référentiel', () => {
  let base: BaseBatte;
  let app: FastifyInstance;
  let idR1: string;
  let idR2: string;
  let idSarrasin: string;
  let idChataigne: string;
  let idConditionnementSarrasin: string;

  /** Le cout par crepe de R2, tel que le rend la route de lecture des recettes. */
  async function coutParCrepeR2(): Promise<number | null> {
    const liste = (await app.inject({ method: 'GET', url: '/api/recettes' })).json<ListeRecettes>();
    return liste.data.find((r) => r.id === idR2)?.coutParCrepeCents ?? null;
  }

  /** Fiche d'ecriture d'une recette, telle que la renvoie `PATCH /api/recettes/:id`. */
  function corpsRecette(
    detail: RecetteDetail,
    lignes: { ingredientId: string; quantiteUniteRef: number }[],
  ) {
    return {
      code: detail.code,
      nom: detail.nom,
      typePate: detail.typePate,
      sansGluten: detail.sansGluten,
      rendementReferenceMl: detail.rendementReferenceMl,
      rendementReferenceCrepes: detail.rendementReferenceCrepes,
      perteCuissonBp: detail.perteCuissonBp,
      tauxCasseBp: detail.tauxCasseBp,
      perteFixeMl: detail.perteFixeMl,
      procede: detail.procede,
      notes: detail.notes,
      lignes,
    };
  }

  beforeAll(async () => {
    // Base en memoire : ces tests ne touchent ni le fichier du poste de travail,
    // ni le dossier de sauvegardes.
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    // Le referentiel seul ne suffit pas : c'est l'HISTORIQUE (réception,
    // production, session close) qui donne a R1 une production, donc un passe a
    // proteger.
    seedDemonstrationActivite(base);

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app);
    await app.register(
      async (api) => {
        await api.register(routesRecettes(base));
        await api.register(routesReferentiel(base));
        await api.register(routesReferentielEcriture(base));
      },
      { prefix: '/api' },
    );
    await app.ready();

    const recettes = (
      await app.inject({ method: 'GET', url: '/api/recettes' })
    ).json<ListeRecettes>();
    idR1 = recettes.data.find((r) => r.code === 'R1')!.id;
    idR2 = recettes.data.find((r) => r.code === 'R2')!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  /* ═══ Ingredients ══════════════════════════════════════════════════════ */

  it('expose les fiches complètes, actifs et inactifs, avec ce qu’une désactivation casserait', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/referentiel/ingredients' });

    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json<ListeIngredientsComplets>();
    expect(corps.data.length).toBeGreaterThan(0);
    // Les quatre compteurs qui rendent une desactivation decidable.
    const premier = corps.data[0]!;
    expect(premier).toHaveProperty('nbConditionnements');
    expect(premier).toHaveProperty('nbLignesRecette');
    expect(premier).toHaveProperty('nbLots');
    expect(premier).toHaveProperty('coutUnitaireCents');
  });

  it('refuse une densité non finie, avec le champ fautif désigné', async () => {
    /**
     * `1e999` s'analyse en `Infinity` par `JSON.parse` : c'est la seule voie par
     * laquelle une densite non finie peut atteindre le serveur (JSON n'a pas de
     * litteral `NaN`). D-034 explique pourquoi cela compte : le stock est la
     * SOMME des mouvements, donc une seule densite non finie rendrait `NaN` le
     * stock de l'ingredient puis tout cout matiere en aval, sans jamais lever.
     */
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/ingredients',
      headers: { 'content-type': 'application/json' },
      payload:
        '{"nom":"Test densité infinie","categorie":"farine","uniteReference":"g","densiteGParMl":1e999,"allergenes":[],"stockSecurite":0}',
    });

    expect(reponse.statusCode).toBe(422);
    const corps = reponse.json<ReponseErreur>();
    expect(corps.erreur.champs?.['densiteGParMl']).toBeDefined();
  });

  it('refuse une densité sur un ingrédient compté à la pièce', async () => {
    // Une quantite en pieces ne se convertit ni en masse ni en volume : la
    // densite ne serait jamais lue, et une valeur qu'on n'utilise jamais fait
    // croire a une capacite qui n'existe pas.
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/ingredients',
      payload: {
        nom: 'Test pièce avec densité',
        categorie: 'garniture',
        uniteReference: 'piece',
        densiteGParMl: 1.2,
        allergenes: [],
        stockSecurite: 0,
      },
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.champs?.['densiteGParMl']).toBeDefined();
  });

  it('crée les deux farines sans gluten qui manquaient à R2', async () => {
    const sarrasin = await app.inject({
      method: 'POST',
      url: '/api/ingredients',
      payload: {
        nom: 'Farine de sarrasin',
        categorie: 'farine',
        uniteReference: 'g',
        densiteGParMl: 0.6,
        allergenes: [],
        // C'est ce champ qui reveille le point de commande : il valait 0 partout.
        stockSecurite: 5000,
        delaiLivraisonJours: 7,
      },
    });
    expect(sarrasin.statusCode).toBe(201);
    const fiche = sarrasin.json<ListeIngredientsComplets['data'][number]>();
    expect(fiche.stockSecurite).toBe(5000);
    // Aucun conditionnement encore : le cout unitaire est ABSENT, pas nul.
    expect(fiche.coutUnitaireCents).toBeNull();
    idSarrasin = fiche.id;

    const chataigne = await app.inject({
      method: 'POST',
      url: '/api/ingredients',
      payload: {
        nom: 'Farine de châtaigne',
        categorie: 'farine',
        uniteReference: 'g',
        densiteGParMl: 0.55,
        allergenes: [],
        stockSecurite: 2000,
      },
    });
    expect(chataigne.statusCode).toBe(201);
    idChataigne = chataigne.json<{ id: string }>().id;
  });

  it('refuse un second ingrédient du même nom, sur le champ « nom »', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/ingredients',
      payload: {
        nom: 'Farine de sarrasin',
        categorie: 'farine',
        uniteReference: 'g',
        allergenes: [],
        stockSecurite: 0,
      },
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.champs?.['nom']).toBeDefined();
  });

  it('rend 404 sur un ingrédient inconnu adressé dans l’URL', async () => {
    const reponse = await app.inject({
      method: 'PATCH',
      url: '/api/ingredients/identifiant-qui-n-existe-pas',
      payload: {
        nom: 'Peu importe',
        categorie: 'farine',
        uniteReference: 'g',
        allergenes: [],
        stockSecurite: 0,
      },
    });

    expect(reponse.statusCode).toBe(404);
  });

  /* ═══ Conditionnements — le prix ═══════════════════════════════════════ */

  it('crée un conditionnement et en déduit un coût unitaire', async () => {
    const fournisseurs = (await app.inject({ method: 'GET', url: '/api/fournisseurs' })).json<{
      data: { id: string; type: string }[];
    }>();
    // Un fournisseur COMMERCIAL : « Inventaire d'ouverture » (type `systeme`)
    // n'est pas un fournisseur, on ne lui commande rien.
    const fournisseurId = fournisseurs.data.find((f) => f.type !== 'systeme')!.id;

    const reponse = await app.inject({
      method: 'POST',
      url: '/api/conditionnements',
      payload: {
        ingredientId: idSarrasin,
        fournisseurId,
        libelle: 'Sac 5 kg',
        quantiteUniteRef: 5000,
        prixCents: 1250,
        datePrix: JOUR_PRIX_INITIAL,
      },
    });

    expect(reponse.statusCode).toBe(201);
    idConditionnementSarrasin = reponse.json<{ id: string }>().id;

    await app.inject({
      method: 'POST',
      url: '/api/conditionnements',
      payload: {
        ingredientId: idChataigne,
        fournisseurId,
        libelle: 'Sachet 500 g',
        quantiteUniteRef: 500,
        prixCents: 480,
        datePrix: JOUR_PRIX_INITIAL,
      },
    });

    const fiches = (
      await app.inject({ method: 'GET', url: '/api/referentiel/ingredients' })
    ).json<ListeIngredientsComplets>();
    const sarrasin = fiches.data.find((i) => i.id === idSarrasin)!;
    // 1250 centimes pour 5000 g : le cout unitaire n'est JAMAIS stocke, il se
    // deduit de prix / contenance (D-018).
    expect(sarrasin.coutUnitaireCents).toBeCloseTo(1250 / 5000, 10);
    expect(sarrasin.nbConditionnements).toBe(1);
  });

  it('filtre les conditionnements par ingrédient', async () => {
    const reponse = await app.inject({
      method: 'GET',
      url: `/api/conditionnements?ingredientId=${idSarrasin}`,
    });

    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json<ListeConditionnements>();
    expect(corps.data.every((c) => c.ingredientId === idSarrasin)).toBe(true);
    expect(corps.data.length).toBe(1);
  });

  /* ═══ LE SCENARIO : R2 se remplit ══════════════════════════════════════ */

  it('rend null le coût par crêpe de R2 tant qu’elle est vide', async () => {
    // « 0,00 € » sur une recette sans ingredient serait un chiffre faux presente
    // comme une donnee. C'est l'etat de depart, celui que docs/13 §4.7 decrit.
    expect(await coutParCrepeR2()).toBeNull();
  });

  it('remplit R2 par une MODIFICATION, parce qu’elle n’a jamais produit', async () => {
    /**
     * D-005 scelle une recette QUI A SERVI, pas une recette qui existe. R2 n'a
     * aucune production : la versionner fabriquerait une v1 vide et
     * definitivement figee, que rien ne pourrait expliquer, et les
     * `produit_vente` qui la pointent resteraient accroches a la coquille.
     */
    const detail = (
      await app.inject({ method: 'GET', url: `/api/recettes/${idR2}` })
    ).json<RecetteDetail>();
    expect(detail.lignes).toHaveLength(0);

    const reponse = await app.inject({
      method: 'PATCH',
      url: `/api/recettes/${idR2}`,
      payload: corpsRecette(detail, [
        { ingredientId: idSarrasin, quantiteUniteRef: 100 },
        { ingredientId: idChataigne, quantiteUniteRef: 45 },
      ]),
    });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json<RecetteDetail>().lignes).toHaveLength(2);
  });

  it('rend le coût par crêpe de R2 calculable là où il valait null', async () => {
    const cout = await coutParCrepeR2();

    expect(cout).not.toBeNull();
    expect(cout!).toBeGreaterThan(0);
  });

  it('ne détruit pas une note technique que l’écran ne peut pas afficher', async () => {
    /**
     * `recette_ligne.note_technique` n'est PAS exposee par `schemaLigneRecette`
     * (contrats/recettes.ts) : l'ecran Recettes ne peut donc ni la lire, ni la
     * renvoyer, et chaque enregistrement porte `null` pour ce champ. Sans
     * conservation cote depot, ouvrir puis reenregistrer une recette effacerait
     * une note qu'on n'a jamais vue — la faute la plus vicieuse d'un
     * formulaire, parce que rien ne la signale.
     *
     * On la pose ici directement en base, faute de route qui l'ecrive : c'est
     * exactement l'etat qu'un futur ecran produirait.
     */
    const NOTE = 'Tamiser la farine avant de la mélanger.';
    base
      .update(schema.recetteLigne)
      .set({ noteTechnique: NOTE })
      .where(eq(schema.recetteLigne.recetteId, idR2))
      .run();

    const detail = (
      await app.inject({ method: 'GET', url: `/api/recettes/${idR2}` })
    ).json<RecetteDetail>();

    const reponse = await app.inject({
      method: 'PATCH',
      url: `/api/recettes/${idR2}`,
      payload: corpsRecette(
        detail,
        detail.lignes.map((l) => ({
          ingredientId: l.ingredientId,
          quantiteUniteRef: l.quantiteReference,
        })),
      ),
    });
    expect(reponse.statusCode).toBe(200);

    const notes = base
      .select({ note: schema.recetteLigne.noteTechnique })
      .from(schema.recetteLigne)
      .where(eq(schema.recetteLigne.recetteId, idR2))
      .all();
    expect(notes.every((l) => l.note === NOTE)).toBe(true);
  });

  it('refuse deux fois le même ingrédient dans une recette, sur la ligne fautive', async () => {
    const detail = (
      await app.inject({ method: 'GET', url: `/api/recettes/${idR2}` })
    ).json<RecetteDetail>();

    const reponse = await app.inject({
      method: 'PATCH',
      url: `/api/recettes/${idR2}`,
      payload: corpsRecette(detail, [
        { ingredientId: idSarrasin, quantiteUniteRef: 100 },
        { ingredientId: idSarrasin, quantiteUniteRef: 45 },
      ]),
    });

    expect(reponse.statusCode).toBe(422);
    // Le chemin porte l'INDEX de la ligne : l'ecran accroche le message sous la
    // bonne ligne, pas en banniere generique.
    expect(reponse.json<ReponseErreur>().erreur.champs?.['lignes.1.ingredientId']).toBeDefined();
  });

  it('active R2 une fois remplie, et la refuserait vide', async () => {
    const reponse = await app.inject({
      method: 'PATCH',
      url: `/api/recettes/${idR2}/statut`,
      payload: { statut: 'active' },
    });

    expect(reponse.statusCode).toBe(200);
    expect(reponse.json<RecetteDetail>().statut).toBe('active');
    expect(reponse.json<RecetteDetail>().dateActivation).not.toBeNull();
  });

  /* ═══ LE SCENARIO : le tarif du meunier change ════════════════════════ */

  it('propage un changement de tarif jusqu’au coût par crêpe', async () => {
    const avant = await coutParCrepeR2();
    expect(avant).not.toBeNull();

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/conditionnements/${idConditionnementSarrasin}/tarifs`,
      // Le meunier augmente : meme sac, prix double, a partir d'une date.
      payload: { prixCents: 2500, datePrix: JOUR_PRIX_SUIVANT },
    });

    expect(reponse.statusCode).toBe(201);

    const apres = await coutParCrepeR2();
    expect(apres!).toBeGreaterThan(avant!);

    // L'ancienne ligne est ARCHIVEE, pas supprimee : c'est elle qui repond a
    // « a quel prix achetais-je en janvier ? ».
    const lignes = (
      await app.inject({ method: 'GET', url: `/api/conditionnements?ingredientId=${idSarrasin}` })
    ).json<ListeConditionnements>();
    expect(lignes.data).toHaveLength(2);
    expect(lignes.data.filter((c) => c.actif)).toHaveLength(1);
    expect(lignes.data.find((c) => !c.actif)?.prixCents).toBe(1250);
  });

  it('refuse un tarif daté avant celui en vigueur, en donnant les deux dates', async () => {
    const actif = (
      await app.inject({ method: 'GET', url: `/api/conditionnements?ingredientId=${idSarrasin}` })
    )
      .json<ListeConditionnements>()
      .data.find((c) => c.actif)!;

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/conditionnements/${actif.id}/tarifs`,
      payload: { prixCents: 999, datePrix: JOUR_PRIX_INITIAL },
    });

    expect(reponse.statusCode).toBe(422);
    const corps = reponse.json<ReponseErreur>();
    // Un enregistrement sans consequence serait pire qu'un refus : le message
    // doit porter la date en vigueur pour etre actionnable.
    expect(corps.erreur.message).toContain(JOUR_PRIX_SUIVANT);
    expect(corps.erreur.champs?.['datePrix']).toBeDefined();
  });

  /* ═══ Versionnage (D-005) ═════════════════════════════════════════════ */

  it('expose le nombre de productions, qui est ce qui scelle une recette', async () => {
    const reponse = await app.inject({ method: 'GET', url: '/api/referentiel/recettes' });

    expect(reponse.statusCode).toBe(200);
    const corps = reponse.json<ListeRecettesReferentiel>();
    const r1 = corps.data.find((r) => r.id === idR1)!;
    const r2 = corps.data.find((r) => r.id === idR2)!;
    // R1 a servi dans le jeu de demonstration, R2 non : c'est exactement la
    // difference qui decide entre « modifier » et « versionner ».
    expect(r1.nbProductions).toBeGreaterThan(0);
    expect(r2.nbProductions).toBe(0);
  });

  it('refuse de modifier une recette qui a déjà produit, en donnant le compte', async () => {
    const detail = (
      await app.inject({ method: 'GET', url: `/api/recettes/${idR1}` })
    ).json<RecetteDetail>();

    const reponse = await app.inject({
      method: 'PATCH',
      url: `/api/recettes/${idR1}`,
      payload: corpsRecette(
        detail,
        detail.lignes.map((l) => ({
          ingredientId: l.ingredientId,
          quantiteUniteRef: l.quantiteReference,
        })),
      ),
    });

    expect(reponse.statusCode).toBe(422);
    const corps = reponse.json<ReponseErreur>();
    expect(corps.erreur.code).toBe('recette_scellee');
    expect(corps.erreur.message).toContain('production');
  });

  it('crée la version suivante, archive la précédente et annonce les produits laissés derrière', async () => {
    const detail = (
      await app.inject({ method: 'GET', url: `/api/recettes/${idR1}` })
    ).json<RecetteDetail>();
    const versionAvant = detail.version;

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/recettes/${idR1}/versions`,
      payload: corpsRecette(
        detail,
        detail.lignes.map((l) => ({
          ingredientId: l.ingredientId,
          // On epaissit legerement la pate : une nouvelle version doit differer.
          quantiteUniteRef: l.quantiteReference + 1,
        })),
      ),
    });

    expect(reponse.statusCode).toBe(201);
    const resultat = reponse.json<ResultatVersionRecette>();
    expect(resultat.version).toBe(versionAvant + 1);
    expect(resultat.recetteParentId).toBe(idR1);
    // `produit_vente.recette_id` pointe une VERSION : les produits restent
    // accroches a celle qu'on vient d'archiver, et le compte doit le dire.
    expect(resultat.produitsSurVersionPrecedente).toBeGreaterThan(0);

    const parent = (
      await app.inject({ method: 'GET', url: `/api/recettes/${idR1}` })
    ).json<RecetteDetail>();
    expect(parent.statut).toBe('archivee');
  });

  it('refuse une version qui changerait le code de la lignée', async () => {
    const referentiel = (
      await app.inject({ method: 'GET', url: '/api/referentiel/recettes' })
    ).json<ListeRecettesReferentiel>();
    const v2 = referentiel.data.find((r) => r.recetteParentId === idR1)!;
    const detail = (
      await app.inject({ method: 'GET', url: `/api/recettes/${v2.id}` })
    ).json<RecetteDetail>();

    const reponse = await app.inject({
      method: 'POST',
      url: `/api/recettes/${v2.id}/versions`,
      payload: {
        ...corpsRecette(
          detail,
          detail.lignes.map((l) => ({
            ingredientId: l.ingredientId,
            quantiteUniteRef: l.quantiteReference,
          })),
        ),
        code: 'R9',
      },
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.champs?.['code']).toBeDefined();
  });

  /* ═══ Lieux de marche ═════════════════════════════════════════════════ */

  it('refuse une latitude sans longitude : une coordonnée seule ne localise rien', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/lieux',
      payload: { nom: 'Marché sans longitude', latitude: 50.64 },
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.champs?.['longitude']).toBeDefined();
  });

  it('refuse un tarif au mètre linéaire sans métrage', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/lieux',
      payload: {
        nom: 'Marché sans métrage',
        tarifEmplacementCents: 1200,
        modeTarification: 'metre_lineaire_mois',
      },
    });

    expect(reponse.statusCode).toBe(422);
    expect(reponse.json<ReponseErreur>().erreur.champs?.['metresLineaires']).toBeDefined();
  });

  it('crée un second marché, ce qui était impossible sans toucher au seed', async () => {
    const avant = (
      await app.inject({ method: 'GET', url: '/api/referentiel/lieux' })
    ).json<ListeLieuxComplets>();

    const reponse = await app.inject({
      method: 'POST',
      url: '/api/lieux',
      payload: {
        nom: 'Marché de test',
        latitude: 50.62,
        longitude: 5.57,
        jourSemaine: 6,
        heureDebut: '08:00',
        heureFin: '13:00',
        tarifEmplacementCents: 1500,
        modeTarification: 'jour',
      },
    });

    expect(reponse.statusCode).toBe(201);
    const cree = reponse.json<ListeLieuxComplets['data'][number]>();
    expect(cree.nbSessions).toBe(0);

    const apres = (
      await app.inject({ method: 'GET', url: '/api/referentiel/lieux' })
    ).json<ListeLieuxComplets>();
    expect(apres.meta.total).toBe(avant.meta.total + 1);

    // Desactivation plutot que suppression, y compris sur un lieu tout neuf.
    const desactive = await app.inject({
      method: 'PATCH',
      url: `/api/lieux/${cree.id}/activite`,
      payload: { actif: false },
    });
    expect(desactive.statusCode).toBe(200);
    expect(desactive.json<{ actif: boolean }>().actif).toBe(false);
  });

  it('refuse une heure de fin antérieure à l’heure de début, avec les deux heures', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/lieux',
      payload: { nom: 'Marché à fenêtre nulle', heureDebut: '10:00', heureFin: '08:00' },
    });

    expect(reponse.statusCode).toBe(422);
    const message = reponse.json<ReponseErreur>().erreur.champs?.['heureFin'] ?? '';
    expect(message).toContain('10:00');
  });

  /* ═══ Ce qui ne doit jamais exister ═══════════════════════════════════ */

  it('n’expose aucune route de suppression', async () => {
    // CLAUDE.md §3 regle 7 : rien ne s'efface. Un ingredient est reference par
    // des lots recus il y a deux ans dont la tracabilite AFSCA doit rester
    // lisible. Ce test est un cliquet : il casse si un DELETE apparait.
    for (const url of [
      `/api/ingredients/${idSarrasin}`,
      `/api/conditionnements/${idConditionnementSarrasin}`,
      `/api/recettes/${idR2}`,
      '/api/lieux/peu-importe',
    ]) {
      const reponse = await app.inject({ method: 'DELETE', url });
      expect(reponse.statusCode, `DELETE ${url} ne doit pas exister`).toBe(404);
    }
  });

  it('fige l’unité de référence dès qu’une quantité l’utilise, en donnant les comptes', async () => {
    /**
     * Passer `g` a `ml` ne convertit rien : cela REINTERPRETE 25 000 g en
     * 25 000 ml, silencieusement. Meme famille de defaut que le `NaN` de
     * densite (D-034) — faux sans jamais lever.
     */
    const fiches = (
      await app.inject({ method: 'GET', url: '/api/referentiel/ingredients' })
    ).json<ListeIngredientsComplets>();
    const engage = fiches.data.find((i) => i.nbLignesRecette > 0 || i.nbLots > 0)!;

    const reponse = await app.inject({
      method: 'PATCH',
      url: `/api/ingredients/${engage.id}`,
      payload: {
        nom: engage.nom,
        categorie: engage.categorie,
        uniteReference: engage.uniteReference === 'g' ? 'ml' : 'g',
        allergenes: engage.allergenes,
        stockSecurite: engage.stockSecurite,
      },
    });

    expect(reponse.statusCode).toBe(422);
    const corps = reponse.json<ReponseErreur>();
    expect(corps.erreur.code).toBe('unite_reference_figee');
    expect(corps.erreur.champs?.['uniteReference']).toBeDefined();
  });

  /**
   * Audit du 29/07/2026 : la garde ci-dessus ne comptait QUE les lots et les
   * lignes de recette — pas les conditionnements. Un ingrédient fraîchement
   * tarifé (un conditionnement existe : « Sac 25 kg » = 25 000 dans son unité)
   * mais jamais encore reçu ni utilisé dans une recette passait donc le
   * changement d'unité SANS refus : `conditionnement.quantite_unite_ref`
   * restait à 25 000, réinterprété dans la nouvelle unité, silencieusement —
   * le taux dérivé par `coutsDeReference`/`coutsUnitaires`
   * (`prix_cents / quantite_unite_ref`) se serait mis à diverger de la réalité
   * physique dès le premier calcul de coût matière. Ingrédient et
   * conditionnement CRÉÉS ICI, isolés du reste du fichier, pour ne dépendre
   * d'aucun ordre d'exécution ni d'aucun état laissé par un test antérieur.
   */
  it('fige aussi l’unité de référence dès qu’un SEUL conditionnement existe, même sans lot ni ligne de recette', async () => {
    const creation = await app.inject({
      method: 'POST',
      url: '/api/ingredients',
      payload: {
        nom: 'Cannelle moulue (audit unité figée)',
        categorie: 'consommable',
        uniteReference: 'g',
        allergenes: [],
        stockSecurite: 0,
      },
    });
    expect(creation.statusCode).toBe(201);
    const idCannelle = creation.json<{ id: string }>().id;

    const fournisseurs = (await app.inject({ method: 'GET', url: '/api/fournisseurs' })).json<{
      data: { id: string; type: string }[];
    }>();
    const fournisseurId = fournisseurs.data.find((f) => f.type !== 'systeme')!.id;

    const conditionnementCree = await app.inject({
      method: 'POST',
      url: '/api/conditionnements',
      payload: {
        ingredientId: idCannelle,
        fournisseurId,
        libelle: 'Boîte 250 g',
        quantiteUniteRef: 250,
        prixCents: 320,
        datePrix: JOUR_PRIX_INITIAL,
      },
    });
    expect(conditionnementCree.statusCode).toBe(201);

    // Ni lot, ni ligne de recette pour cet ingrédient à ce stade : seul un
    // conditionnement existe. C'est exactement le cas que l'ancienne garde
    // laissait passer.
    const reponse = await app.inject({
      method: 'PATCH',
      url: `/api/ingredients/${idCannelle}`,
      payload: {
        nom: 'Cannelle moulue (audit unité figée)',
        categorie: 'consommable',
        uniteReference: 'ml',
        allergenes: [],
        stockSecurite: 0,
      },
    });

    expect(reponse.statusCode).toBe(422);
    const corps = reponse.json<ReponseErreur>();
    expect(corps.erreur.code).toBe('unite_reference_figee');
    expect(corps.erreur.champs?.['uniteReference']).toBeDefined();
    // Le message doit nommer le conditionnement, pas seulement lots et lignes.
    expect(corps.erreur.message).toContain('1 conditionnement');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Calcul automatique de la distance d'un lieu (D-064, séance du 30/07/2026)
   ═══════════════════════════════════════════════════════════════════════════
   Base et serveur SÉPARÉS du describe ci-dessus : ces tests posent leur propre
   clé OpenRouteService et leur propre adresse de domicile dans l'environnement
   et les paramètres, ce qui ne doit RIEN changer aux tests déjà existants.

   INTERDIT ABSOLU de la mission : aucun de ces tests n'appelle le service réel.
   Les racines OpenRouteService sont INJECTÉES (`itineraireOptions`, objet
   MUTABLE partagé, relu à chaque requête) vers des serveurs `node:http`
   locaux, ou vers un port mort pour simuler une panne réseau — jamais vers
   `api.openrouteservice.org`. */

describe('lieux — calcul automatique de la distance (D-064)', () => {
  /** Port local qui n'écoute jamais : sert à prouver qu'AUCUN appel n'a lieu. */
  const RACINE_MORTE = 'http://127.0.0.1:1';

  /**
   * Racines injectées dans le plugin de routes, MUTÉES entre les requêtes
   * pour simuler tantôt un succès, tantôt une panne — voir
   * `routesReferentielEcriture`, qui les relit à CHAQUE appel plutôt que de
   * les figer à l'enregistrement du plugin.
   */
  const itineraireOptions: { racineGeocodage: string; racineItineraire: string } = {
    racineGeocodage: RACINE_MORTE,
    racineItineraire: RACINE_MORTE,
  };

  function demarrerServeur(
    statut: number,
    corps: unknown,
  ): Promise<{ url: string; fermer: () => Promise<void> }> {
    return new Promise((resolve) => {
      const serveur: Server = createServer((requete, reponse) => {
        requete.on('data', () => {});
        requete.on('end', () => {
          // `Connection: close` + `closeAllConnections()` ci-dessous : sans
          // eux, `fetch` garde le socket en vie (keep-alive) et `serveur.close()`
          // attend jusqu'au `keepAliveTimeout` par défaut du serveur HTTP,
          // dépassant le délai de test par défaut de Vitest.
          reponse.writeHead(statut, { 'content-type': 'application/json', Connection: 'close' });
          reponse.end(JSON.stringify(corps));
        });
      });
      serveur.listen(0, '127.0.0.1', () => {
        const adresse = serveur.address();
        const port = typeof adresse === 'object' && adresse !== null ? adresse.port : 0;
        resolve({
          url: `http://127.0.0.1:${port}`,
          fermer: () =>
            new Promise((resoudre) => {
              serveur.close(() => resoudre());
              serveur.closeAllConnections();
            }),
        });
      });
    });
  }

  const corpsGeocodage = (longitude: number, latitude: number): unknown => ({
    features: [{ geometry: { coordinates: [longitude, latitude] } }],
  });
  const corpsItineraire = (distanceMetres: number): unknown => ({
    routes: [{ summary: { distance: distanceMetres } }],
  });

  let base: BaseBatte;
  let app: FastifyInstance;
  let idLieu: string;

  const envInitial: Record<string, string | undefined> = {};
  function definir(cle: string, valeur: string | undefined): void {
    if (!(cle in envInitial)) envInitial[cle] = process.env[cle];
    if (valeur === undefined) delete process.env[cle];
    else process.env[cle] = valeur;
  }

  function definirAdresseDepart(valeur: string): void {
    base
      .update(schema.parametre)
      .set({ valeur })
      .where(eq(schema.parametre.cle, 'adresse_depart_defaut'))
      .run();
  }

  beforeAll(async () => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    definirAdresseDepart('Rue de la Paix 1, 4000 Liège');

    app = Fastify({ logger: false });
    enregistrerGestionnaireErreurs(app);
    await app.register(
      async (api) => {
        await api.register(routesReferentielEcriture(base, { itineraireOptions }));
      },
      { prefix: '/api' },
    );
    await app.ready();
  });

  beforeEach(() => {
    definir('OPENROUTESERVICE_API_KEY', 'sk-or-fixture-test');
  });

  afterEach(() => {
    for (const [cle, valeur] of Object.entries(envInitial)) {
      if (valeur === undefined) delete process.env[cle];
      else process.env[cle] = valeur;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('calcule automatiquement la distance quand le champ est laissé vide', async () => {
    const geocodage = await demarrerServeur(200, corpsGeocodage(5.57, 50.62));
    const itineraire = await demarrerServeur(200, corpsItineraire(42_000));
    itineraireOptions.racineGeocodage = geocodage.url;
    itineraireOptions.racineItineraire = itineraire.url;

    try {
      const creation = await app.inject({
        method: 'POST',
        url: '/api/lieux',
        payload: { nom: 'Marché du calcul automatique', adresse: 'Place Saint-Lambert, Liège' },
      });

      expect(creation.statusCode).toBe(201);
      const corps = creation.json<{
        id: string;
        distanceKm: number | null;
        distanceCalculAutomatique: { reussi: boolean; attribution?: string } | null;
      }>();
      expect(corps.distanceKm).toBe(42);
      expect(corps.distanceCalculAutomatique?.reussi).toBe(true);
      // Licence CC-BY 4.0 : l'attribution accompagne la distance calculée.
      expect(corps.distanceCalculAutomatique?.attribution).toContain('OpenStreetMap');
      idLieu = corps.id;
    } finally {
      await geocodage.fermer();
      await itineraire.fermer();
    }
  });

  it('une correction manuelle n’est JAMAIS recalculée tant qu’elle n’est pas effacée', async () => {
    // Racines pointées vers un port mort : si le code tentait malgré tout un
    // calcul, cette assertion échouerait (mauvais statut, ou distance changée).
    itineraireOptions.racineGeocodage = RACINE_MORTE;
    itineraireOptions.racineItineraire = RACINE_MORTE;

    const correction = await app.inject({
      method: 'PATCH',
      url: `/api/lieux/${idLieu}`,
      payload: {
        nom: 'Marché du calcul automatique',
        adresse: 'Place Saint-Lambert, Liège',
        // Le porteur corrige la valeur calculée automatiquement (42 → 99).
        distanceKm: 99,
      },
    });

    expect(correction.statusCode).toBe(200);
    const corps = correction.json<{
      distanceKm: number | null;
      distanceCalculAutomatique: unknown;
    }>();
    expect(corps.distanceKm).toBe(99);
    // Aucune tentative : rien à signaler, contrairement à la création ci-dessus.
    expect(corps.distanceCalculAutomatique).toBeNull();

    // Un second enregistrement, valeur INCHANGÉE (le formulaire resoumet la
    // même fiche sans y toucher) : la correction manuelle tient toujours.
    const reenregistrement = await app.inject({
      method: 'PATCH',
      url: `/api/lieux/${idLieu}`,
      payload: {
        nom: 'Marché du calcul automatique',
        adresse: 'Place Saint-Lambert, Liège',
        distanceKm: 99,
      },
    });
    expect(reenregistrement.statusCode).toBe(200);
    expect(reenregistrement.json<{ distanceKm: number | null }>().distanceKm).toBe(99);
  });

  it('un champ VIDÉ PAR LE PORTEUR redéclenche légitimement un nouveau calcul', async () => {
    const geocodage = await demarrerServeur(200, corpsGeocodage(5.6, 50.6));
    // Distance DIFFÉRENTE de la précédente (15 et non 42) : la nouvelle valeur
    // ne peut pas être confondue avec un reliquat de l'ancien calcul.
    const itineraire = await demarrerServeur(200, corpsItineraire(15_000));
    itineraireOptions.racineGeocodage = geocodage.url;
    itineraireOptions.racineItineraire = itineraire.url;

    try {
      const reponse = await app.inject({
        method: 'PATCH',
        url: `/api/lieux/${idLieu}`,
        payload: {
          nom: 'Marché du calcul automatique',
          adresse: 'Place Saint-Lambert, Liège',
          // Le porteur efface lui-même sa correction manuelle (99).
          distanceKm: null,
        },
      });

      expect(reponse.statusCode).toBe(200);
      const corps = reponse.json<{
        distanceKm: number | null;
        distanceCalculAutomatique: { reussi: boolean } | null;
      }>();
      // 99 (la correction manuelle) est bien remplacé : c'est le porteur,
      // en vidant le champ, qui a demandé ce nouveau calcul.
      expect(corps.distanceKm).toBe(15);
      expect(corps.distanceCalculAutomatique?.reussi).toBe(true);
    } finally {
      await geocodage.fermer();
      await itineraire.fermer();
    }
  });

  it('nomme la raison quand l’adresse de domicile n’est pas configurée', async () => {
    definirAdresseDepart('');

    const reponse = await app.inject({
      method: 'POST',
      url: '/api/lieux',
      payload: { nom: 'Marché sans domicile configuré', adresse: 'Rue Neuve, Liège' },
    });

    expect(reponse.statusCode).toBe(201);
    const corps = reponse.json<{
      distanceKm: number | null;
      distanceCalculAutomatique: { reussi: boolean; raison: string } | null;
    }>();
    expect(corps.distanceKm).toBeNull();
    expect(corps.distanceCalculAutomatique?.reussi).toBe(false);
    expect(corps.distanceCalculAutomatique?.raison).toContain('Adresse de départ par défaut');

    definirAdresseDepart('Rue de la Paix 1, 4000 Liège');
  });

  it('sans clé configurée : refus motivé, jamais un appel réseau', async () => {
    definir('OPENROUTESERVICE_API_KEY', undefined);
    // Racines mortes : la preuve qu'aucun appel n'est tenté est que la requête
    // aboutit quand même, immédiatement.
    itineraireOptions.racineGeocodage = RACINE_MORTE;
    itineraireOptions.racineItineraire = RACINE_MORTE;

    const reponse = await app.inject({
      method: 'POST',
      url: '/api/lieux',
      payload: { nom: 'Marché sans clé', adresse: 'Rue Neuve, Liège' },
    });

    expect(reponse.statusCode).toBe(201);
    const corps = reponse.json<{
      distanceKm: number | null;
      distanceCalculAutomatique: { reussi: boolean; raison: string } | null;
    }>();
    expect(corps.distanceKm).toBeNull();
    expect(corps.distanceCalculAutomatique?.reussi).toBe(false);
    expect(corps.distanceCalculAutomatique?.raison).toContain('OPENROUTESERVICE_API_KEY');
  });

  it('un lieu sans adresse n’est jamais soumis au calcul automatique', async () => {
    const reponse = await app.inject({
      method: 'POST',
      url: '/api/lieux',
      payload: { nom: 'Marché sans adresse' },
    });

    expect(reponse.statusCode).toBe(201);
    const corps = reponse.json<{
      distanceKm: number | null;
      distanceCalculAutomatique: { reussi: boolean; raison: string } | null;
    }>();
    expect(corps.distanceKm).toBeNull();
    expect(corps.distanceCalculAutomatique?.reussi).toBe(false);
    expect(corps.distanceCalculAutomatique?.raison).toContain('adresse');
  });
});
