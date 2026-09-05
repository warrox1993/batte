/**
 * Routes d'ECRITURE du referentiel de base : ingredients, conditionnements,
 * recettes et lieux de marche.
 *
 * POURQUOI CE FICHIER EXISTE. docs/13 §4.7 classe en trou de gravite 2 le fait
 * que ces cinq tables (`ingredient`, `conditionnement`, `recette`,
 * `recette_ligne`, `lieu_marche`) ne soient ecrites QUE par
 * `packages/db/src/seed/`. Le depot qui repare cela existait deja
 * (`packages/db/src/depots/referentiel-ecriture.ts`) — mais sans route, il
 * n'etait atteignable par rien. C'est ce dernier maillon.
 *
 * Ce que cela debloque, concretement :
 *  - **R2 peut etre remplie.** La recette sarrasin-chataigne est semee vide et
 *    en brouillon ; son cout par crepe vaut `null` et le restait a vie ;
 *  - **un changement de tarif du meunier devient saisissable.** Le prix vit
 *    dans `conditionnement.prix_cents` (D-018), donc le cout matiere etait fige
 *    au prix de la graine ;
 *  - **le stock de securite devient saisissable**, ce qui reveille le point de
 *    commande et tout l'ecran de reapprovisionnement.
 *
 * L'API ASSEMBLE ET VALIDE, ELLE NE DECIDE RIEN (regle d'architecture n°1).
 * Aucune regle metier n'est ecrite ici :
 *  - les bornes, formats et coherences viennent des schemas Zod PURS de
 *    `@batte/core` (`contrats/referentiel.ts`), partages avec le navigateur ;
 *  - l'existence des lignes referencees, l'unicite, et l'etat de la base
 *    (« cette recette a-t-elle deja produit ? ») viennent du depot, qui leve
 *    des `ErreurMetier` typees ;
 *  - chaque reponse est REVALIDEE contre le contrat partage avant de partir :
 *    le serveur ne se fait pas confiance a lui-meme.
 *
 * Conventions d'erreur (D-035), sans une ligne de code ici :
 *  - **404** quand la ressource ADRESSEE DANS L'URL n'existe pas
 *    (`ErreurIntrouvable`, levee par le depot) ;
 *  - **422 + `champs`** quand une valeur SAISIE DANS UN FORMULAIRE est
 *    invalide — produit soit par les `path` des issues Zod, soit par le
 *    `champs` d'une `ErreurMetier`. L'ecran sait alors sous quel champ
 *    accrocher le message.
 *
 * AUCUNE ROUTE DE SUPPRESSION, ET IL NE DOIT JAMAIS EN EXISTER (CLAUDE.md §3
 * regle 7). Un ingredient est reference par des lots recus il y a deux ans dont
 * la tracabilite AFSCA doit rester lisible ; un lieu est reference par des
 * sessions cloturees, qui sont des pieces comptables conservees dix ans. On
 * desactive (`PATCH …/activite`), on ne supprime pas.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  resoudrePointDepartSession,
  schemaChangementActivite,
  schemaChangementStatutRecette,
  schemaConditionnement,
  schemaIngredientComplet,
  schemaLieuComplet,
  schemaListeConditionnements,
  schemaListeIngredientsComplets,
  schemaListeLieuxComplets,
  schemaListeRecettesReferentiel,
  schemaNouveauTarif,
  schemaRecetteDetail,
  schemaResultatVersionRecette,
  schemaSaisieConditionnement,
  schemaSaisieIngredient,
  schemaSaisieLieu,
  schemaSaisieRecette,
  type ResultatCalculAutomatiqueDistance,
  type SaisieLieu,
} from '@batte/core';
import { lireParametres, lireRecetteDetail, type BaseBatte } from '@batte/db';
import {
  calculerDistanceRoutiere,
  itineraireConfigure,
  type OptionsCalculDistance,
} from '../itineraire/client.js';
import {
  changerActiviteConditionnement,
  changerActiviteIngredient,
  changerActiviteLieu,
  changerStatutRecette,
  creerConditionnement,
  creerIngredient,
  creerLieu,
  creerRecette,
  creerVersionRecette,
  enregistrerNouveauTarif,
  listerConditionnements,
  listerIngredientsComplets,
  listerLieuxComplets,
  listerRecettesReferentiel,
  modifierConditionnement,
  modifierIngredient,
  modifierLieu,
  modifierRecette,
} from '@batte/db';

/**
 * Retrouve la ligne qu'on vient d'ecrire, pour la renvoyer a l'appelant.
 *
 * Une absence ici n'est PAS une faute de l'utilisateur : l'ecriture vient de
 * reussir dans une transaction commitee. C'est une incoherence interne, donc
 * une vraie 500 — jamais un 404, qui laisserait croire a une mauvaise saisie.
 * Meme fonction et meme raisonnement que dans `routes/referentiel.ts`.
 */
function retrouver<T extends { id: string }>(lignes: T[], id: string, quoi: string): T {
  const ligne = lignes.find((l) => l.id === id);
  if (ligne === undefined) throw new Error(`${quoi} ${id} introuvable après écriture.`);
  return ligne;
}

/**
 * Detail complet d'une recette apres ecriture.
 *
 * Meme raisonnement que `retrouver` : la transaction a commite, une absence
 * serait une incoherence interne et non une adresse fautive.
 */
function detailApresEcriture(base: BaseBatte, id: string) {
  const detail = lireRecetteDetail(base, id);
  if (detail === null) throw new Error(`Recette ${id} introuvable après écriture.`);
  return schemaRecetteDetail.parse(detail);
}

/** Filtre facultatif de `GET /api/conditionnements`. Un filtre, pas une adresse. */
const schemaFiltreConditionnements = z.object({
  ingredientId: z.string().min(1).optional(),
});

/**
 * Tente un calcul AUTOMATIQUE de la distance routière d'un lieu, une fois
 * (D-064, séance du 30/07/2026) : « l'application doit pouvoir calculer
 * automatiquement les km sans mon intervention ; je dois être là pour
 * vérifier ».
 *
 * RÈGLE STRUCTURANTE — comment une correction manuelle survit à un recalcul
 * SANS colonne dédiée (`distance_km_origine` resterait à créer, voir le
 * rapport de l'agent) : cette fonction ne se déclenche QUE quand le
 * formulaire soumet `distanceKm: null`. Un champ NON VIDE n'est JAMAIS
 * touché — qu'il ait été saisi à la main ou calculé automatiquement la fois
 * précédente. Un champ VIDÉ PAR LE PORTEUR (il efface la valeur puis
 * enregistre) redevient `null` dans CETTE requête précise, donc redéclenche
 * légitimement une tentative : c'est le porteur, et lui seul, qui décide qu'un
 * nouveau calcul est bienvenu. Aucune lecture (`GET`) n'appelle jamais cette
 * fonction — un seul appel réseau par lieu, jamais par affichage (CLAUDE.md
 * §5, étendu ici par le porteur).
 *
 * Ne lève JAMAIS : une panne du service ne doit jamais empêcher d'enregistrer
 * un lieu. La distance reste alors `null`, avec une raison nommée.
 */
async function distanceAvecCalculAutomatique(
  base: BaseBatte,
  saisie: SaisieLieu,
  /**
   * Racines de service injectables — UNIQUEMENT pour les tests (voir
   * `OptionsCalculDistance` dans `apps/api/src/itineraire/client.ts`). En
   * production, `serveur.ts` n'en fournit jamais et les vraies racines
   * d'OpenRouteService s'appliquent.
   */
  itineraireOptions: OptionsCalculDistance = {},
): Promise<{ saisie: SaisieLieu; calcul: ResultatCalculAutomatiqueDistance | null }> {
  if (saisie.distanceKm !== null) {
    // Valeur déjà connue (saisie manuelle, ou valeur non effacée par le
    // formulaire) : elle gagne toujours, on ne consulte même pas le service.
    return { saisie, calcul: null };
  }

  if (saisie.adresse === null) {
    return {
      saisie,
      calcul: {
        reussi: false,
        raison:
          "Ce lieu n'a pas d'adresse renseignée : le calcul automatique de distance est " +
          'impossible. Renseignez une adresse, ou saisissez la distance vous-même.',
      },
    };
  }

  if (!itineraireConfigure()) {
    return {
      saisie,
      calcul: {
        reussi: false,
        raison:
          "Le calcul automatique de distance n'est pas configuré. Renseignez " +
          'OPENROUTESERVICE_API_KEY dans le fichier .env du poste pour l’activer. ' +
          'La saisie manuelle de la distance reste disponible en attendant.',
      },
    };
  }

  // Résolution de la valeur (« chaîne vide ou faite de blancs = non renseignée »)
  // délégable à `resoudrePointDepartSession` (@batte/core, point-depart.ts) :
  // MÊME logique de nettoyage que l'ancien `nonVide` local, désormais retiré.
  // `pointDepartTexteSession: null` en dur : cette route n'a pas de notion de
  // session, seul le paramètre compte.
  //
  // Sa `raisonIndisponible`, en revanche, N'EST PAS reprise : elle est écrite
  // pour son seul consommateur actuel, le coût de déplacement d'UNE SESSION
  // (« le coût de déplacement n'est pas calculable »). Ici, c'est le calcul
  // AUTOMATIQUE DE DISTANCE D'UN LIEU qui est bloqué, pas un coût de
  // déplacement — et le porteur doit savoir qu'il peut encore saisir la
  // distance à la main. Un test le vérifie déjà (référentiel-ecriture.test.ts,
  // « nomme la raison quand l'adresse de domicile n'est pas configurée » :
  // attend « Adresse de départ par défaut », absent du message générique) :
  // les deux messages ne sont PAS interchangeables malgré la valeur commune.
  const adresseDepart = resoudrePointDepartSession({
    pointDepartTexteSession: null,
    adresseDepartDefautParametre: lireParametres(base).texte('adresse_depart_defaut'),
  }).texte;
  if (adresseDepart === null) {
    return {
      saisie,
      calcul: {
        reussi: false,
        raison:
          '« Adresse de départ par défaut » n’est pas renseignée dans l’écran Paramètres : le ' +
          'calcul automatique de distance est impossible tant qu’elle ne l’est pas. La ' +
          'saisie manuelle de la distance reste disponible.',
      },
    };
  }

  const resultat = await calculerDistanceRoutiere(
    {
      depart: { type: 'adresse', adresse: adresseDepart },
      arrivee:
        saisie.latitude !== null && saisie.longitude !== null
          ? {
              type: 'coordonnees',
              coordonnees: { latitude: saisie.latitude, longitude: saisie.longitude },
            }
          : { type: 'adresse', adresse: saisie.adresse },
    },
    itineraireOptions,
  );

  if (!resultat.disponible) {
    return { saisie, calcul: { reussi: false, raison: resultat.raison } };
  }

  /*
   * `resultat.distanceKm` peut porter une décimale (D-074) : l'itinéraire ne
   * jette plus la précision au kilomètre entier. Cette fonction se contente de
   * la reporter telle quelle — AUCUN arrondi ici, à raison.
   *
   * ═══ COMMENTAIRE CORRIGÉ le 01/08/2026 — il prescrivait un geste dangereux ═══
   *
   * Il affirmait que deux frontières restaient déclarées `z.int()` et
   * « DOIVENT être assouplies dans le MÊME mouvement que la migration de
   * `lieu_marche.distance_km` en `real` ». **Les deux affirmations sont
   * fausses aujourd'hui, et la seconde est une consigne à ne pas suivre.**
   *
   * 1. Les frontières citées sont DÉJÀ `z.number()` :
   *    `contrats/lieux.ts` (`schemaLigneComparaisonLieu.distanceKm`) et
   *    `contrats/referentiel.ts` (`schemaLieuComplet.distanceKm`).
   * 2. La migration en `real` a été **essayée sur une copie de la base réelle
   *    du porteur, et elle a ÉCHOUÉ** (`FOREIGN KEY constraint failed`,
   *    D-074). Elle est **abandonnée**, pas différée — le problème d'arrondi
   *    qui la motivait a été réglé à la source.
   *
   * Un lecteur suivant ce commentaire aurait tenté une reconstruction de
   * table sur `lieu_marche`, référencée par les sessions et les observations
   * météo. C'est le seul commentaire de ce dépôt qui pouvait coûter une base.
   */
  return {
    saisie: { ...saisie, distanceKm: resultat.distanceKm },
    calcul: { reussi: true, attribution: resultat.attribution },
  };
}

export type OptionsRoutesReferentielEcriture = {
  /**
   * Racines OpenRouteService injectables — UNIQUEMENT pour les tests, jamais
   * fournies par `serveur.ts` en production. Voir `distanceAvecCalculAutomatique`.
   */
  readonly itineraireOptions?: OptionsCalculDistance;
};

export function routesReferentielEcriture(
  base: BaseBatte,
  options: OptionsRoutesReferentielEcriture = {},
): FastifyPluginAsync {
  const itineraireOptions = options.itineraireOptions ?? {};

  return async (app) => {
    /* ═══ Ingredients ════════════════════════════════════════════════════ */

    /**
     * Fiches COMPLETES, actifs ET inactifs.
     *
     * Distincte de `GET /api/ingredients` (routes/referentiel.ts), qui ne rend
     * que les actifs et un sous-ensemble des colonnes, et dont quatre ecrans
     * dependent. Les deux coexistent, et c'est voulu : un ecran de referentiel
     * doit montrer ce qui est desactive et ce qu'une desactivation casserait
     * (conditionnements, lignes de recette, lots) ; un selecteur de reception
     * ne le doit surtout pas.
     */
    app.get('/referentiel/ingredients', async () => {
      const lignes = listerIngredientsComplets(base);
      return schemaListeIngredientsComplets.parse({ data: lignes, meta: { total: lignes.length } });
    });

    app.post('/ingredients', async (requete, reponse) => {
      const saisie = schemaSaisieIngredient.parse(requete.body);
      const id = creerIngredient(base, saisie);

      reponse.code(201);
      return schemaIngredientComplet.parse(
        retrouver(listerIngredientsComplets(base), id, 'Ingrédient'),
      );
    });

    app.patch<{ Params: { id: string } }>('/ingredients/:id', async (requete) => {
      const saisie = schemaSaisieIngredient.parse(requete.body);
      // Leve `ErreurIntrouvable` (404) si l'identifiant de l'URL n'existe pas ;
      // leve `unite_reference_figee` (422 + champs, avec le NOMBRE de lots et
      // de lignes concernes) si des quantites sont deja exprimees dans l'unite.
      modifierIngredient(base, requete.params.id, saisie);

      return schemaIngredientComplet.parse(
        retrouver(listerIngredientsComplets(base), requete.params.id, 'Ingrédient'),
      );
    });

    /** Desactivation / reactivation. Le remplacant de la suppression. */
    app.patch<{ Params: { id: string } }>('/ingredients/:id/activite', async (requete) => {
      const { actif } = schemaChangementActivite.parse(requete.body);
      changerActiviteIngredient(base, requete.params.id, actif);

      return schemaIngredientComplet.parse(
        retrouver(listerIngredientsComplets(base), requete.params.id, 'Ingrédient'),
      );
    });

    /* ═══ Conditionnements — le format d'achat, et donc LE PRIX ══════════ */

    app.get('/conditionnements', async (requete) => {
      const filtre = schemaFiltreConditionnements.parse(requete.query);
      const lignes =
        filtre.ingredientId === undefined
          ? listerConditionnements(base)
          : listerConditionnements(base, filtre.ingredientId);

      return schemaListeConditionnements.parse({ data: lignes, meta: { total: lignes.length } });
    });

    app.post('/conditionnements', async (requete, reponse) => {
      const saisie = schemaSaisieConditionnement.parse(requete.body);
      const id = creerConditionnement(base, saisie);

      reponse.code(201);
      return schemaConditionnement.parse(
        retrouver(listerConditionnements(base), id, 'Conditionnement'),
      );
    });

    /**
     * CORRIGER une fiche : la valeur saisie etait fausse, elle n'a jamais ete
     * vraie (faute de frappe, mauvaise contenance relevee).
     *
     * A ne pas confondre avec `POST …/tarifs` ci-dessous — c'est la distinction
     * de D-042 pour les parametres, et pour la meme raison. Corriger reecrit le
     * prix a sa date d'origine, donc reecrit retroactivement tout cout matiere
     * recalcule depuis cette date.
     */
    app.patch<{ Params: { id: string } }>('/conditionnements/:id', async (requete) => {
      const saisie = schemaSaisieConditionnement.parse(requete.body);
      modifierConditionnement(base, requete.params.id, saisie);

      return schemaConditionnement.parse(
        retrouver(listerConditionnements(base), requete.params.id, 'Conditionnement'),
      );
    });

    /**
     * FAIRE EVOLUER le tarif : le prix etait juste et change a partir d'une
     * date. Une ligne datee est ajoutee, la precedente est archivee — c'est ce
     * qui rend calculable « le meunier a-t-il augmente ses prix ? ».
     *
     * Sous-ressource au pluriel (`/tarifs`) et non un verbe : on CREE une ligne
     * de prix, on ne declenche pas une action.
     */
    app.post<{ Params: { id: string } }>(
      '/conditionnements/:id/tarifs',
      async (requete, reponse) => {
        const tarif = schemaNouveauTarif.parse(requete.body);
        // Refuse une date anterieure ou egale, avec les DEUX dates dans le
        // message : un enregistrement sans consequence serait pire qu'un refus.
        const resultat = enregistrerNouveauTarif(base, requete.params.id, tarif);

        reponse.code(201);
        return schemaConditionnement.parse(
          retrouver(listerConditionnements(base), resultat.conditionnementId, 'Conditionnement'),
        );
      },
    );

    app.patch<{ Params: { id: string } }>('/conditionnements/:id/activite', async (requete) => {
      const { actif } = schemaChangementActivite.parse(requete.body);
      changerActiviteConditionnement(base, requete.params.id, actif);

      return schemaConditionnement.parse(
        retrouver(listerConditionnements(base), requete.params.id, 'Conditionnement'),
      );
    });

    /* ═══ Recettes — ecriture et versionnage (D-005) ═════════════════════ */

    /**
     * Ce qui decide du geste possible sur chaque recette.
     *
     * `GET /api/recettes` rend le resume metier et le cout par crepe ; il ne dit
     * pas combien de PRODUCTIONS referencent chaque version. Or c'est ce compte,
     * et non le statut, qui scelle une recette (D-005). L'ecran s'en sert pour
     * nommer le bon bouton avant le clic, plutot que de laisser l'utilisateur
     * decouvrir la regle par un refus.
     */
    app.get('/referentiel/recettes', async () => {
      const lignes = listerRecettesReferentiel(base);
      return schemaListeRecettesReferentiel.parse({ data: lignes, meta: { total: lignes.length } });
    });

    /**
     * Cree une recette. Elle nait en BROUILLON — `lancerProduction` refuse
     * toute recette qui n'est pas `active`, donc une recette activee d'office
     * pourrait etre produite avant d'avoir ete relue.
     */
    app.post('/recettes', async (requete, reponse) => {
      const saisie = schemaSaisieRecette.parse(requete.body);
      const id = creerRecette(base, saisie);

      reponse.code(201);
      return detailApresEcriture(base, id);
    });

    /**
     * Modifie une recette EN PLACE.
     *
     * Refuse des qu'elle a servi a produire (`recette_scellee`, 422, avec le
     * NOMBRE de productions concernees) : la modifier reecrirait leur cout
     * matiere, qui est une piece comptable (D-005). Le cas de R2 — semee vide,
     * jamais produite — passe donc par ici : la remplir est une modification,
     * pas une nouvelle version.
     */
    app.patch<{ Params: { id: string } }>('/recettes/:id', async (requete) => {
      const saisie = schemaSaisieRecette.parse(requete.body);
      modifierRecette(base, requete.params.id, saisie);

      return detailApresEcriture(base, requete.params.id);
    });

    /**
     * Cree la version suivante (D-005) et archive la precedente, dans la meme
     * transaction.
     *
     * La reponse porte `produitsSurVersionPrecedente` : `produit_vente.recette_id`
     * pointe une VERSION precise, donc les produits restent accroches a celle
     * qu'on vient d'archiver. On ne les redirige pas en silence — repointer un
     * produit change ce qui sera consomme au prochain marche — mais on rend le
     * compte, sans quoi personne ne le decouvrirait.
     */
    app.post<{ Params: { id: string } }>('/recettes/:id/versions', async (requete, reponse) => {
      const saisie = schemaSaisieRecette.parse(requete.body);
      const resultat = creerVersionRecette(base, requete.params.id, saisie);

      reponse.code(201);
      return schemaResultatVersionRecette.parse(resultat);
    });

    /**
     * Change le statut. Indispensable et pas cosmetique : `lancerProduction`
     * refuse toute recette qui n'est pas `active`, donc remplir R2 sans pouvoir
     * l'activer refermerait le trou a moitie.
     */
    app.patch<{ Params: { id: string } }>('/recettes/:id/statut', async (requete) => {
      const { statut } = schemaChangementStatutRecette.parse(requete.body);
      changerStatutRecette(base, requete.params.id, statut);

      return detailApresEcriture(base, requete.params.id);
    });

    /* ═══ Lieux de marche ════════════════════════════════════════════════ */

    /**
     * Lieux COMPLETS, actifs ET inactifs, coordonnees comprises.
     *
     * `GET /api/lieux` (routes/sessions.ts) ne rend que les actifs et cinq
     * colonnes — ni latitude, ni longitude, alors que ce sont elles que le
     * moteur de prevision passe a Open-Meteo. On ajoute a cote, on ne la
     * modifie pas : `Sessions.tsx` en depend.
     */
    app.get('/referentiel/lieux', async () => {
      const lignes = listerLieuxComplets(base);
      return schemaListeLieuxComplets.parse({ data: lignes, meta: { total: lignes.length } });
    });

    app.post('/lieux', async (requete, reponse) => {
      const saisieBrute = schemaSaisieLieu.parse(requete.body);
      const { saisie, calcul } = await distanceAvecCalculAutomatique(
        base,
        saisieBrute,
        itineraireOptions,
      );
      const id = creerLieu(base, saisie);

      reponse.code(201);
      return schemaLieuComplet.parse({
        ...retrouver(listerLieuxComplets(base), id, 'Lieu de marché'),
        distanceCalculAutomatique: calcul,
      });
    });

    app.patch<{ Params: { id: string } }>('/lieux/:id', async (requete) => {
      const saisieBrute = schemaSaisieLieu.parse(requete.body);
      const { saisie, calcul } = await distanceAvecCalculAutomatique(
        base,
        saisieBrute,
        itineraireOptions,
      );
      modifierLieu(base, requete.params.id, saisie);

      return schemaLieuComplet.parse({
        ...retrouver(listerLieuxComplets(base), requete.params.id, 'Lieu de marché'),
        distanceCalculAutomatique: calcul,
      });
    });

    /** Desactivation / reactivation. Des sessions cloturees referencent ce lieu. */
    app.patch<{ Params: { id: string } }>('/lieux/:id/activite', async (requete) => {
      const { actif } = schemaChangementActivite.parse(requete.body);
      changerActiviteLieu(base, requete.params.id, actif);

      return schemaLieuComplet.parse(
        retrouver(listerLieuxComplets(base), requete.params.id, 'Lieu de marché'),
      );
    });
  };
}
