/**
 * État DÉRIVÉ du parcours de premier lancement (docs/06, correction du
 * 31/07/2026) — huit questions à réponse vraie à chaque instant, calculées
 * depuis la base, jamais déclarées par l'utilisateur (CLAUDE.md §3 règle 5,
 * même doctrine que le stock : « le stock ne se modifie que par un
 * mouvement » devient ici « aucun de ces huit signaux ne se déclare, ils se
 * mesurent »).
 *
 * Les huit signaux se répartissent en DEUX NATURES qui ne se mélangent
 * jamais — dérivées en les RENCONTRANT plutôt qu'en les devinant
 * (`packages/db/src/chemin-minimal-session.test.ts`, sections 5 et 6) :
 *
 *  - BLOQUANT (4) : sans cette création, `creerSession` ou `cloturerSession`
 *    (`packages/db/src/services/sessions.ts`) lève une erreur nommée — la
 *    clôture est TECHNIQUEMENT impossible. `aLieu`, `aRecette` (même vide —
 *    nécessaire pour créer un produit `transforme`, jamais pour un
 *    `revendu`), `aProduitVendable`, `aSession`.
 *  - FAUSSANT (4) : rien ne bloque, mais un chiffre affiché ment tant que
 *    c'est faux. Le cas mesuré (fichier ci-dessus, section 5) : le chemin
 *    minimal absolu clôture une session AVEC SUCCÈS et affiche pourtant un
 *    coût matière à zéro et une marge brute à 100 % du CA — parce qu'aucun
 *    ingrédient n'a jamais été reçu ni consommé. `aIngredient`, `aReception`,
 *    `aRecetteActiveAvecLignes`, `aProductionRattacheeSession`.
 *
 * Chaque champ est une requête D'EXISTENCE (`.limit(1)`), jamais un
 * `count()` intégral : la question posée est « y en a-t-il au moins un ? »,
 * pas « combien ? » — et une table de sessions qui grossit pendant des
 * années ne doit jamais ralentir ce contrôle, consulté à chaque ouverture du
 * tableau de bord.
 *
 * TYPE DE RETOUR ANNOTÉ EXPLICITEMENT, ET C'EST VOULU. Une fonction de dépôt
 * sans annotation de retour peut violer silencieusement le contrat Zod
 * qu'elle alimente : l'inférence recopie alors exactement ce que la fonction
 * rend, manque compris, et `tsc` ne dit rien — l'erreur ne sort qu'en
 * HTTP 422 au premier appel réel (défaut déjà rencontré deux fois dans ce
 * dépôt, cassant quatre routes d'un coup).
 *
 * `EtatDemarrageDepot` est structurellement IDENTIQUE à `EtatDemarrage`
 * (`@batte/core`, `packages/core/src/contrats/demarrage.ts`), mais redéclarée
 * ICI plutôt qu'importée : ce fichier ne doit dépendre d'AUCUNE ligne du
 * baril de `@batte/core` (`packages/core/src/contrats/index.ts`) ni de celui
 * de `@batte/db` (`packages/db/src/index.ts`), tous deux hors du périmètre
 * d'écriture de cette mission — voir son rapport de livraison pour les deux
 * lignes exactes à y ajouter. En attendant ces deux ajouts, ce fichier
 * compile et se teste seul, sans rien casser ailleurs dans le dépôt ; une
 * fois les deux lignes ajoutées, les deux types coïncident champ par champ
 * et `apps/api/src/routes/demarrage.ts` peut valider `etatDemarrage(base)`
 * contre `schemaEtatDemarrage.parse(...)`.
 */

import { and, eq, isNotNull, ne } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import {
  ingredient,
  lieuMarche,
  produitVente,
  production,
  recette,
  recetteLigne,
  reception,
  sessionMarche,
} from '../schema.js';

export type EtatDemarrageDepot = {
  readonly aLieu: boolean;
  readonly aRecette: boolean;
  readonly aProduitVendable: boolean;
  readonly aSession: boolean;
  readonly aIngredient: boolean;
  readonly aReception: boolean;
  readonly aRecetteActiveAvecLignes: boolean;
  readonly aProductionRattacheeSession: boolean;
};

/** Vrai s'il existe au moins une ligne — jamais un `count()` complet. */
function existe(lignes: readonly unknown[]): boolean {
  return lignes.length > 0;
}

export function etatDemarrage(base: BaseBatte): EtatDemarrageDepot {
  const aLieu = existe(
    base
      .select({ id: lieuMarche.id })
      .from(lieuMarche)
      .where(eq(lieuMarche.actif, true))
      .limit(1)
      .all(),
  );

  // Existence pure, quel que soit le statut : une recette même en brouillon,
  // même sans aucune ligne, suffit à créer un produit `transforme` (chemin
  // minimal, section 3). Le statut ET les lignes sont vérifiés ENSEMBLE par
  // `aRecetteActiveAvecLignes`, plus bas — deux questions distinctes.
  const aRecette = existe(base.select({ id: recette.id }).from(recette).limit(1).all());

  const aProduitVendable = existe(
    base
      .select({ id: produitVente.id })
      .from(produitVente)
      .where(eq(produitVente.actif, true))
      .limit(1)
      .all(),
  );

  // Une session ANNULÉE ne compte pas : ce n'est plus une session « à
  // clôturer ni déjà clôturée » (règle n°7, contrepassation — elle reste en
  // base, mais elle ne répond plus à la question posée ici).
  const aSession = existe(
    base
      .select({ id: sessionMarche.id })
      .from(sessionMarche)
      .where(ne(sessionMarche.statut, 'annulee'))
      .limit(1)
      .all(),
  );

  const aIngredient = existe(
    base
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(eq(ingredient.actif, true))
      .limit(1)
      .all(),
  );

  // Une réception ANNULÉE n'a jamais laissé de matière réellement disponible
  // (règle n°7 : contrepassation) : elle ne compte pas comme « du stock est
  // entré ».
  const aReception = existe(
    base
      .select({ id: reception.id })
      .from(reception)
      .where(eq(reception.statut, 'active'))
      .limit(1)
      .all(),
  );

  // Jointure plutôt que deux requêtes séparées : la question posée est « une
  // MÊME recette est-elle À LA FOIS active ET pourvue d'au moins une ligne ? »
  // — une recette active sans ligne et une recette brouillon avec lignes ne
  // répondent NI L'UNE NI L'AUTRE au besoin réel (produire réellement
  // quelque chose, voir `lancerProduction` qui refuse les deux cas
  // séparément : `recette_non_active` et `recette_vide`).
  const aRecetteActiveAvecLignes = existe(
    base
      .select({ id: recette.id })
      .from(recette)
      .innerJoin(recetteLigne, eq(recetteLigne.recetteId, recette.id))
      .where(eq(recette.statut, 'active'))
      .limit(1)
      .all(),
  );

  // Une production ANNULÉE n'a jamais consommé de stock pour de vrai (elle
  // aussi une contrepassation) ; `sessionId` non nul est ce qui distingue une
  // pâte réellement destinée à une session d'un simple essai en atelier
  // (`production.session_id`, nullable — voir `packages/db/src/schema.ts`).
  const aProductionRattacheeSession = existe(
    base
      .select({ id: production.id })
      .from(production)
      .where(and(isNotNull(production.sessionId), ne(production.statut, 'annulee')))
      .limit(1)
      .all(),
  );

  return {
    aLieu,
    aRecette,
    aProduitVendable,
    aSession,
    aIngredient,
    aReception,
    aRecetteActiveAvecLignes,
    aProductionRattacheeSession,
  };
}
