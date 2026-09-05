/**
 * Routes `/api/palmares/produits` et `/api/palmares/fournisseurs` — le
 * palmarès du tableau de bord (mission « le palmarès du tableau de bord,
 * décidé par le porteur »).
 *
 * ORCHESTRE, NE CALCULE PAS (même règle que `routes/lieux-rentabilite.ts`
 * et `routes/previsions.ts`) : toute l'arithmétique (agrégation, marge,
 * tri, seuil d'échantillon, comparaison de prix) vit dans
 * `packages/core/src/palmares.ts`, fonctions pures et testées. Cette route
 * ne fait que lire ce qui existe déjà via `@batte/db` et composer.
 *
 * HISTOIRE À GARDER : `/api/palmares/*` a été le cas d'école de D-045
 * (`docs/39` §2) — testée en isolation, absente du vrai serveur, et personne
 * ne l'a vu parce qu'une liste de routes écrite à la main la déclarait
 * présente. Le code a été corrigé ; le commentaire qui portait l'incident,
 * lui, a continué d'annoncer une absence pendant des heures. Une route testée
 * en isolation n'est PAS une route servie : seule la table de routage de
 * Fastify après `app.ready()` en fait foi.
 *
 * PÉRIODE : 365 jours glissants jusqu'à aujourd'hui (`bornesPeriodePalmares`,
 * `@batte/core`) — jamais « depuis toujours » (fige le classement de l'an
 * dernier), jamais l'année civile stricte (redevient quasi vide chaque
 * 1er janvier), jamais la dernière session seule (du bruit). Voir la
 * justification complète en tête de `packages/core/src/palmares.ts`.
 *
 * CE QUE CETTE ROUTE NE PEUT PAS ENCORE DONNER (décrit, pas deviné — voir le
 * rapport de livraison pour le détail complet) :
 *  - le volume vendu par produit sur une fenêtre de dates n'a AUCUNE lecture
 *    dédiée dans `packages/db` : cette route reconstitue l'agrégat en
 *    rejouant `lireSessionDetail` sur chaque session close de la période
 *    (coût acceptable au rythme d'une session par semaine ; une vraie
 *    agrégation SQL serait préférable si le volume de sessions grossissait) ;
 *  - le délai de livraison et la qualité produit fournisseur ne sont PAS
 *    calculables aujourd'hui : aucune lecture n'expose une réception avec la
 *    date d'envoi de sa commande d'origine, ni `lot.fournisseur_id` aux
 *    côtés des non-conformités. Les deux valent toujours `null`.
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  agregerEconomiesParFournisseur,
  agregerFiabiliteFacturationParFournisseur,
  agregerVentesParProduit,
  bornesPeriodePalmares,
  comparerPrixParIngredient,
  construireGroupePalmaresFournisseurs,
  construireGroupePalmaresProduits,
  construireLigneClassementFournisseur,
  construireLigneClassementProduit,
  fournisseursProposables,
  RAISON_DELAI_LIVRAISON_INDISPONIBLE,
  RAISON_QUALITE_PRODUIT_INDISPONIBLE,
  SEUIL_MINIMUM_ECHANTILLON_PALMARES,
  schemaPalmaresFournisseurs,
  schemaPalmaresProduits,
  type LigneClassementProduit,
} from '@batte/core';
import {
  aujourdHui,
  lireSessionDetail,
  listerCoutsRevientProduits,
  listerConditionnements,
  listerEconomies,
  listerFactures,
  listerFournisseurs,
  listerSessions,
  type BaseBatte,
} from '@batte/db';

export function routesPalmares(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    /* ─── Produits : deux classements séparés, transformé et revendu ────── */

    app.get('/palmares/produits', async () => {
      const jour = aujourdHui();
      const periode = bornesPeriodePalmares(jour);

      const sessionsClosesPeriode = listerSessions(base).filter(
        (s) =>
          s.statut === 'cloturee' && s.dateSession >= periode.debut && s.dateSession <= periode.fin,
      );

      // Aucune lecture existante n'agrège les ventes par produit sur une
      // fenêtre de dates (voir l'en-tête de ce fichier) : on rejoue le détail
      // de chaque session close de la période, déjà exposé par
      // `lireSessionDetail` pour l'écran Sessions.
      const ventes = sessionsClosesPeriode.flatMap((s) => {
        const detail = lireSessionDetail(base, s.id);
        if (detail === null) return [];
        return detail.ventes.map((v) => ({
          produitVenteId: v.produitVenteId,
          quantite: v.quantite,
          montantCents: v.montantCents,
        }));
      });
      const agregats = agregerVentesParProduit(ventes);

      const lignes: LigneClassementProduit[] = listerCoutsRevientProduits(base).map((c) =>
        construireLigneClassementProduit(
          {
            produitVenteId: c.produitVenteId,
            nom: c.nom,
            nature: c.nature,
            coutMatiereUnitaireCents: c.coutMatiereCents,
          },
          agregats.get(c.produitVenteId),
        ),
      );

      const groupes = [
        construireGroupePalmaresProduits('transforme', lignes, sessionsClosesPeriode.length),
        construireGroupePalmaresProduits('revendu', lignes, sessionsClosesPeriode.length),
      ];

      return schemaPalmaresProduits.parse({
        periode,
        seuilMinimumEchantillon: SEUIL_MINIMUM_ECHANTILLON_PALMARES,
        nbSessionsClosesPeriode: sessionsClosesPeriode.length,
        groupes,
      });
    });

    /* ─── Fournisseurs : trois critères calculables, deux hors de portée ─── */

    app.get('/palmares/fournisseurs', async () => {
      const jour = aujourdHui();
      const periode = bornesPeriodePalmares(jour);

      // Même exclusion qu'ailleurs dans ce dépôt (`fournisseursProposables`,
      // `@batte/core`) : « Inventaire d'ouverture » n'est pas un fournisseur,
      // et un fournisseur désactivé disparaît des classements comme des
      // listes de choix.
      const fournisseurs = fournisseursProposables(listerFournisseurs(base));

      const economiesPeriode = listerEconomies(base, { debut: periode.debut, fin: periode.fin });
      const economieParFournisseur = agregerEconomiesParFournisseur(economiesPeriode);

      const facturesPeriode = listerFactures(base).filter(
        (f) => !f.estAnnulee && f.dateFacture >= periode.debut && f.dateFacture <= periode.fin,
      );
      const fiabiliteParFournisseur = agregerFiabiliteFacturationParFournisseur(facturesPeriode);

      // Le prix comparable n'a pas de fenêtre de dates : c'est un instantané
      // du TARIF ACTIF aujourd'hui (voir `comparerPrixParIngredient`), pas un
      // historique de la période — comparer des tarifs d'époques différentes
      // n'aurait aucun sens.
      const conditionnements = listerConditionnements(base);
      const prixParFournisseur = comparerPrixParIngredient(conditionnements);

      const lignes = fournisseurs.map((f) =>
        construireLigneClassementFournisseur(
          { id: f.id, nom: f.nom },
          economieParFournisseur.get(f.id) ?? 0,
          fiabiliteParFournisseur.get(f.id),
          prixParFournisseur.get(f.id),
        ),
      );

      const groupe = construireGroupePalmaresFournisseurs(
        lignes,
        facturesPeriode.length,
        economiesPeriode.length,
      );

      return schemaPalmaresFournisseurs.parse({
        periode,
        seuilMinimumEchantillon: SEUIL_MINIMUM_ECHANTILLON_PALMARES,
        nbFacturesConsiderees: facturesPeriode.length,
        nbLignesEconomiesConsiderees: economiesPeriode.length,
        echantillonSuffisant: groupe.echantillonSuffisant,
        raisonEchantillonInsuffisant: groupe.raisonEchantillonInsuffisant,
        raisonDelaiLivraisonIndisponible: RAISON_DELAI_LIVRAISON_INDISPONIBLE,
        raisonQualiteProduitIndisponible: RAISON_QUALITE_PRODUIT_INDISPONIBLE,
        lignes: groupe.lignes,
      });
    });
  };
}
