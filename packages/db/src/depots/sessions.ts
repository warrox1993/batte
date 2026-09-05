/**
 * Lecture des sessions et compteurs de seuils legaux.
 */

import {
  depassementProjete,
  projeterSeuil,
  ratioEnPointsDeBase,
  schemaMeteoSessionReleve,
  statutParPlafond,
  type CompteurSeuil,
  type MeteoSessionReleve,
  type Statut,
} from '@batte/core';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import {
  evenement,
  lieuMarche,
  mouvementStock,
  produitVente,
  sessionFrais,
  sessionMarche,
  sessionVente,
} from '../schema.js';
import { lireParametres } from './parametres.js';
import { syntheseExercice } from './comptabilite.js';

/**
 * Relevé météo figé à la clôture (`session_marche.meteo_prevue` /
 * `meteo_reelle`, colonnes JSON — audit du 30/07/2026).
 *
 * Ces colonnes reviennent en `unknown` : Drizzle ne peut rien promettre du
 * contenu d'un texte sérialisé sans `$type` posé sur `schema.ts` (hors
 * périmètre d'écriture ici). Validées par le MÊME schéma Zod que celui qui
 * les a écrites (`cloturerSession`) — CLAUDE.md §4, « Zod à toutes les
 * frontières » — plutôt qu'un cast (même principe que `objetOuNull` dans
 * `depots/audit.ts`, en plus strict : ce fichier n'a pas droit au cast).
 * `null` si aucun relevé n'a été figé, ou si la valeur stockée ne correspond
 * pas à la forme attendue — cas qui ne se produit avec aucun code actuel,
 * mais une lecture ne doit jamais faire confiance aveuglément à un texte
 * désérialisé.
 */
function releveMeteoSessionOuNull(valeur: unknown): MeteoSessionReleve | null {
  const resultat = schemaMeteoSessionReleve.nullable().safeParse(valeur);
  return resultat.success ? resultat.data : null;
}

/** Duree d'une session en minutes, ou `null` si les heures manquent. */
function dureeMinutes(debut: string | null, fin: string | null): number | null {
  if (debut === null || fin === null) return null;
  const [hd, md] = debut.split(':').map(Number);
  const [hf, mf] = fin.split(':').map(Number);
  if (hd === undefined || md === undefined || hf === undefined || mf === undefined) return null;
  const minutes = hf * 60 + mf - (hd * 60 + md);
  return minutes > 0 ? minutes : null;
}

export function listerSessions(base: BaseBatte) {
  return (
    base
      .select({
        id: sessionMarche.id,
        numero: sessionMarche.numero,
        lieuId: sessionMarche.lieuId,
        lieuNom: lieuMarche.nom,
        dateSession: sessionMarche.dateSession,
        statut: sessionMarche.statut,
        caTotalCents: sessionMarche.caTotalCents,
        margeNetteCents: sessionMarche.margeNetteCents,
        crepesProduites: sessionMarche.crepesProduites,
        crepesVendues: sessionMarche.crepesVendues,
        ecartCaisseCents: sessionMarche.ecartCaisseCents,
        exclureDuModele: sessionMarche.exclureDuModele,
        evenementId: sessionMarche.evenementId,
        evenementNom: evenement.nom,
      })
      .from(sessionMarche)
      .innerJoin(lieuMarche, eq(sessionMarche.lieuId, lieuMarche.id))
      // LEFT JOIN : `evenement_id` reste NULL pour une session régulière — le
      // cas majoritaire, et il le restera (migration 0020).
      .leftJoin(evenement, eq(sessionMarche.evenementId, evenement.id))
      .orderBy(desc(sessionMarche.dateSession), desc(sessionMarche.numero))
      .all()
      .map((s) => ({
        id: s.id,
        numero: s.numero,
        lieuId: s.lieuId,
        lieuNom: s.lieuNom,
        dateSession: s.dateSession,
        statut: s.statut,
        caTotalCents: s.caTotalCents,
        margeNetteCents: s.margeNetteCents,
        // `null` avant cloture : un taux d'ecoulement sans production n'a pas de sens.
        tauxEcoulementBp:
          s.crepesProduites === 0 ? null : ratioEnPointsDeBase(s.crepesVendues, s.crepesProduites),
        ecartCaisseCents: s.ecartCaisseCents,
        crepesVendues: s.crepesVendues,
        exclureDuModele: s.exclureDuModele,
        evenementId: s.evenementId,
        evenementNom: s.evenementNom,
      }))
  );
}

/** Une ligne de `session_frais` : le détail d'un frais de session, avec son éventuel justificatif. */
export type FraisSessionLigne = {
  readonly id: string;
  readonly libelle: string;
  readonly categorie: string;
  readonly montantCents: number;
  readonly justificatifPath: string | null;
};

/**
 * Détail des frais d'UNE session (Trou 2, audit du 30/07/2026).
 * `session_frais` est écrit à chaque clôture (une ligne par catégorie non
 * nulle, `services/sessions.ts::cloturerSession`) et n'était relu NULLE PART :
 * une donnée saisie pour rien.
 *
 * EXPOSÉ plutôt que documenté comme simple redondance : `session_frais` est
 * au détail des frais ce que `mouvement_stock` est au stock (règle
 * d'architecture n°5) — un ledger d'écritures à côté d'un agrégat stocké (les
 * quatre colonnes `frais_*_cents` de `session_marche`). Aujourd'hui, chaque
 * ligne écrite reprend exactement une des quatre colonnes (une catégorie =
 * un montant = zéro détail supplémentaire), et `justificatifPath` est
 * toujours `null` : la table est donc, EN L'ÉTAT, redondante avec les quatre
 * colonnes. Mais ne jamais l'exposer serait refermer la porte pour rien :
 * c'est le seul endroit qui pourrait un jour porter plusieurs frais « divers »
 * dans la même catégorie, chacun avec SON justificatif — exactement ce que la
 * colonne `justificatif_path` promet depuis le Lot 6. L'exposer ici ne coûte
 * rien et ne suppose rien de plus que ce que la table contient réellement.
 *
 * Reste à câbler côté contrat (voir le rapport de livraison pour le champ
 * exact à ajouter à `schemaSessionDetail`, `packages/core/src/contrats/sessions.ts`) :
 * `routes/sessions.ts` n'a besoin d'AUCUNE modification, il spread déjà
 * `detail` à travers `schemaSessionDetail.parse(...)`.
 */
export function listerFraisSession(base: BaseBatte, sessionId: string): FraisSessionLigne[] {
  return base
    .select({
      id: sessionFrais.id,
      libelle: sessionFrais.libelle,
      categorie: sessionFrais.categorie,
      montantCents: sessionFrais.montantCents,
      justificatifPath: sessionFrais.justificatifPath,
    })
    .from(sessionFrais)
    .where(eq(sessionFrais.sessionId, sessionId))
    .orderBy(asc(sessionFrais.categorie))
    .all();
}

export function lireSessionDetail(base: BaseBatte, id: string) {
  const entete = base
    .select({ session: sessionMarche, lieuNom: lieuMarche.nom, evenementNom: evenement.nom })
    .from(sessionMarche)
    .innerJoin(lieuMarche, eq(sessionMarche.lieuId, lieuMarche.id))
    // LEFT JOIN : `evenement_id` reste NULL pour une session régulière.
    .leftJoin(evenement, eq(sessionMarche.evenementId, evenement.id))
    .where(eq(sessionMarche.id, id))
    .get();

  if (entete === undefined) return null;
  const s = entete.session;

  const ventes = base
    .select({
      produitVenteId: sessionVente.produitVenteId,
      nomProduit: produitVente.nom,
      quantite: sessionVente.quantite,
      prixUnitaireCents: sessionVente.prixUnitaireCents,
      montantCents: sessionVente.montantCents,
      creneauHoraire: sessionVente.creneauHoraire,
    })
    .from(sessionVente)
    .innerJoin(produitVente, eq(sessionVente.produitVenteId, produitVente.id))
    .where(eq(sessionVente.sessionId, id))
    .orderBy(produitVente.nom)
    .all();

  const duree = dureeMinutes(s.heureDebutReelle, s.heureFinReelle);
  const margeNette = s.margeNetteCents;
  const nbArticles = ventes.reduce((total, v) => total + v.quantite, 0);

  /**
   * Matiere du TRANSFORME (production + garnitures) SEULE, reconstituee a
   * partir du ledger des mouvements plutot que stockee : `sessionMarche` ne
   * porte qu'un cout matiere TOTAL (`cout_matiere_cents`), transforme et
   * revendu confondus — ajouter une colonne exigerait une migration de
   * `schema.ts`, hors perimetre ici. Le ledger, lui, est deja la source de
   * verite (CLAUDE.md regle 5) : chaque sortie « revendu » est un mouvement
   * `sortie_vente` sur l'ingredient MEME du produit revendu, jamais partage
   * avec une garniture (chacune a sa propre cle d'ingredient, cf. graine de
   * demonstration). Sommer ces mouvements-la donne le cout revendu exact,
   * sans avoir a le stocker separement.
   *
   * Sans cette separation, `coutRevientParCrepeCents` (docs/17 fiche 12)
   * divisait le cout d'achat d'un pot de sirop revendu par le nombre de
   * crepes vendues — un pot n'a rien a voir avec une crepe.
   */
  const idsIngredientsRevendus = base
    .selectDistinct({ id: produitVente.ingredientId })
    .from(produitVente)
    .where(and(eq(produitVente.nature, 'revendu'), isNotNull(produitVente.ingredientId)))
    .all()
    .map((r) => r.id)
    .filter((idIngredient): idIngredient is string => idIngredient !== null);

  const coutRevenduReconstitueCents =
    idsIngredientsRevendus.length === 0
      ? 0
      : (base
          .select({ total: sql<number>`COALESCE(SUM(${mouvementStock.coutCents}), 0)` })
          .from(mouvementStock)
          .where(
            and(
              eq(mouvementStock.sessionId, id),
              eq(mouvementStock.type, 'sortie_vente'),
              eq(mouvementStock.isAnnule, false),
              inArray(mouvementStock.ingredientId, idsIngredientsRevendus),
            ),
          )
          .get()?.total ?? 0);

  const coutMatiereTransformeCents =
    s.coutMatiereCents === null ? null : s.coutMatiereCents - coutRevenduReconstitueCents;

  /**
   * Cout d'electricite RETENU dans la marge (fiche 17, cas 3 seulement —
   * facturation au compteur), reconstitue depuis le ledger `session_frais`
   * (categorie `energie`) plutot que stocke sur une colonne dediee — meme
   * raison que `coutRevenduReconstitueCents` ci-dessus : ajouter une colonne
   * exigerait une migration de `schema.ts`, hors perimetre de cet agent.
   *
   * `0` quand aucune ligne n'existe : soit un ZERO CERTAIN (aucune
   * electricite sur ce lieu, ou deja comptee dans l'emplacement/le forfait),
   * soit un zero par EXCLUSION (donnee manquante a la cloture) — les deux se
   * lisent IDENTIQUEMENT ici, exactement comme les quatre autres postes de
   * frais (`fraisEmplacementCents`, etc.) : seul `ResultatCloture.avertissementEnergie`,
   * EPHEMERE, distinguait les deux juste apres l'enregistrement.
   */
  const fraisEnergieCents =
    base
      .select({ total: sql<number>`COALESCE(SUM(${sessionFrais.montantCents}), 0)` })
      .from(sessionFrais)
      .where(and(eq(sessionFrais.sessionId, id), eq(sessionFrais.categorie, 'energie')))
      .get()?.total ?? 0;

  return {
    id: s.id,
    numero: s.numero,
    lieuId: s.lieuId,
    lieuNom: entete.lieuNom,
    dateSession: s.dateSession,
    statut: s.statut,
    caTotalCents: s.caTotalCents,
    margeNetteCents: margeNette,
    tauxEcoulementBp:
      s.crepesProduites === 0 ? null : ratioEnPointsDeBase(s.crepesVendues, s.crepesProduites),
    ecartCaisseCents: s.ecartCaisseCents,
    crepesVendues: s.crepesVendues,
    exclureDuModele: s.exclureDuModele,
    evenementId: s.evenementId,
    evenementNom: entete.evenementNom,

    // Météo FIGÉE à la clôture (audit du 30/07/2026, voir `releveMeteoSessionOuNull`
    // ci-dessus) : `null` tant qu'aucun relevé exploitable n'existait pour ce
    // lieu et cette date au moment de la clôture — jamais reconstitué après
    // coup (CLAUDE.md §7).
    meteoPrevue: releveMeteoSessionOuNull(s.meteoPrevue),
    meteoReelle: releveMeteoSessionOuNull(s.meteoReelle),
    // Date de clôture RÉELLE, distincte de `statut === 'cloturee'` qui dit
    // seulement QUE la session l'est. Écrite depuis toujours
    // (`services/sessions.ts::cloturerSession`) mais absente de ce dépôt
    // jusqu'à cet audit : `null` = pas encore clôturée.
    dateCloture: s.dateCloture,

    heureDebutReelle: s.heureDebutReelle,
    heureFinReelle: s.heureFinReelle,
    fondsCaisseInitialCents: s.fondsCaisseInitialCents,
    especesCompteesCents: s.especesCompteesCents,
    caEspecesCents: s.caEspecesCents,
    caCarteCents: s.caCarteCents,
    caTransformeCents: s.caTransformeCents,
    caRevenduCents: s.caRevenduCents,
    caSurPlaceCents: s.caSurPlaceCents,
    coutMatiereCents: s.coutMatiereCents,
    commissionCarteCents: s.commissionCarteCents,
    fraisEmplacementCents: s.fraisEmplacementCents,
    fraisDeplacementCents: s.fraisDeplacementCents,
    fraisGazCents: s.fraisGazCents,
    fraisDiversCents: s.fraisDiversCents,
    // Fiche 17, cas 3 seulement (facturation au compteur) — voir le
    // commentaire au point de calcul ci-dessus.
    fraisEnergieCents,
    // Kilometres REELLEMENT parcourus (D-064), saisis a la cloture et jusqu'ici
    // jamais relus : le fil ecran -> contrat -> service -> base etait pose et
    // teste, mais ce depot ne les renvoyait pas (Trou 1, audit du 30/07/2026)
    // — une session close n'affichait donc jamais le kilometrage saisi.
    // `null` = non renseigne, JAMAIS 0 (CLAUDE.md §7) : un zero laisserait
    // croire a une session sans deplacement, gratuite en carburant et en usure.
    distanceReelleKm: s.distanceReelleKm,
    // Imputation FIGEE de la tournee reelle entre la session et les achats
    // (D-064 point 4, `imputationTourneeDeplacement` — persistee a la
    // cloture, migration 0027, `services/sessions.ts::cloturerSession`) :
    // jamais recalculee ici, contrairement au CUMP (D-018/D-020) — voir le
    // raisonnement complet dans `cloturerSession`. `null` = pas calculable
    // (distance reelle non saisie, ou distance de reference du lieu
    // inconnue), JAMAIS 0 (CLAUDE.md §7) : un zero laisserait croire a une
    // tournee ou un detour gratuits.
    coutDeplacementReelSessionCents: s.coutDeplacementReelSessionCents,
    coutDeplacementReelDetourAchatsCents: s.coutDeplacementReelDetourAchatsCents,
    coutDeplacementReelTotalCents: s.coutDeplacementReelTotalCents,
    crepesProduites: s.crepesProduites,
    // Comment `crepesProduites` a ete obtenu, et la mesure d'origine (D-057).
    // `null` sur les deux colonnes = session close avant leur existence, ou
    // mode « je compte les crepes » pour `volumeRestantMesureMl` seul.
    modeCloture: s.modeCloture,
    volumeRestantMesureMl: s.volumeRestantMesureMl,
    crepesInvendues: s.crepesInvendues,
    crepesCassees: s.crepesCassees,
    margeBruteCents: s.margeBruteCents,
    // `null` quand la duree est inconnue : un denominateur invente donnerait un
    // chiffre faux presente comme une mesure.
    margeParHeureCents:
      duree === null || margeNette === null ? null : Math.round(margeNette / (duree / 60)),
    // `nb_transactions` porte des TICKETS. Il reste `null` tant qu'ils n'ont
    // pas ete comptes : un panier moyen calcule sur des articles vaut la moitie
    // du vrai des qu'un client prend deux produits (D-039).
    panierMoyenCents:
      s.nbTransactions === null || s.nbTransactions === 0 || s.caTotalCents === null
        ? null
        : Math.round(s.caTotalCents / s.nbTransactions),
    // Toujours calculable, et nomme pour ce qu'il est.
    prixMoyenParArticleCents:
      s.caTotalCents === null || nbArticles === 0 ? null : Math.round(s.caTotalCents / nbArticles),
    // Matiere du TRANSFORME / crepes vendues — comparable aux 0,33-0,45 €
    // de CLAUDE.md §6, precisement parce que la matiere REVENDUE en est exclue.
    coutMatiereParCrepeCents:
      s.crepesVendues === 0 || coutMatiereTransformeCents === null
        ? null
        : Math.round(coutMatiereTransformeCents / s.crepesVendues),
    // Cout COMPLET (matiere du transforme + frais + commission) / crepes
    // vendues. Anciennement `coutRevientParCrepeCents`, qui divisait AUSSI le
    // cout d'achat des marchandises revendues par les crepes vendues — voir
    // docs/17 fiche 12. Le nom change avec le calcul.
    coutCompletParCrepeVendueCents:
      s.crepesVendues === 0 || coutMatiereTransformeCents === null
        ? null
        : Math.round(
            (coutMatiereTransformeCents +
              s.fraisEmplacementCents +
              s.fraisDeplacementCents +
              s.fraisGazCents +
              s.fraisDiversCents +
              fraisEnergieCents +
              (s.commissionCarteCents ?? 0)) /
              s.crepesVendues,
          ),
    notesQualitatives: s.notesQualitatives,
    motifExclusion: s.motifExclusion,
    ventes,
    // Trou 2 : détail des frais, jusqu'ici saisi et jamais relu. Voir
    // `listerFraisSession` ci-dessus pour l'arbitrage et ce qu'il reste à
    // câbler côté contrat pour que l'API le serve.
    fraisDetail: listerFraisSession(base, id),
  };
}

/**
 * Definition d'un compteur de seuil legal.
 *
 * Le libelle et la source viennent d'ici et non d'un litteral dans l'ecran :
 * `parametre.source` porte deja l'origine du CHIFFRE, mais c'est ici qu'on dit
 * ce que le compteur MESURE — et deux des trois seuils sont douteux
 * (docs/07 §6.6), ce qui doit rester visible a l'ecran.
 */
const SEUILS = [
  {
    cle: 'seuil_franchise_tva_cents',
    libelle: 'Franchise TVA',
    assiette: 'total' as const,
    source: 'CA total (transformé + revendu). Sortie de la franchise au-delà.',
  },
  {
    cle: 'seuil_airbag_cents',
    libelle: 'Éligibilité Airbag',
    assiette: 'total' as const,
    source:
      "Critère d'ÉLIGIBILITÉ, pas un plafond à ne pas dépasser — et il suppose 3 ans " +
      "d'ancienneté en complémentaire. À confirmer auprès du Forem.",
  },
  {
    cle: 'seuil_cotisation_reduite_cents',
    libelle: 'Cotisation réduite',
    /**
     * REVENU NET, et non chiffre d'affaires — c'est la seule des trois assiettes
     * qui differe, et elle etait comparee au CA comme les deux autres.
     *
     * Le champ `assiette` existait deja sur les trois definitions et n'etait lu
     * NULLE PART : l'intention etait posee, le cablage manquait. Mesure sur le
     * rythme de reference de CLAUDE.md §6 : au bout de 21 sessions, le CA vaut
     * 17 598 EUR et le compteur criait « depassement » a 101,3 %, quand le
     * revenu net estime valait 7 617 EUR, soit 43,8 %. Facteur 2,31.
     *
     * Le sens de l'erreur compte : le net etant toujours inferieur au CA,
     * l'alerte ne pouvait pas arriver trop TARD. Elle arrivait trop TOT, ce qui
     * est plus insidieux — un compteur qui crie au loup desensibilise
     * l'utilisateur aux deux vrais compteurs de CA, ceux qui, eux, peuvent lui
     * faire perdre la franchise TVA sans prevenir.
     */
    assiette: 'revenu_net' as const,
    source:
      'Étiquetage douteux : 17 374,08 € est le revenu de référence des cotisations minimales ' +
      "d'un indépendant à titre PRINCIPAL. À confirmer auprès de la caisse d'assurances sociales.",
  },
  {
    cle: 'seuil_sce_cents',
    libelle: 'Caisse enregistreuse certifiée (SCE)',
    /**
     * CA des SERVICES DE RESTAURATION (consommation SUR PLACE), et non le CA
     * total — assiette DIFFÉRENTE des deux seuils de franchise TVA / Airbag,
     * exactement la distinction que D-054 a dû cabler pour le revenu net.
     * Confondre les deux assiettes ici referait la meme erreur qu'a l'epoque
     * (facteur different, meme defaut de raisonnement) : la vente a emporter
     * n'est pas un service de restauration, donc ne doit JAMAIS gonfler ce
     * compteur.
     */
    assiette: 'ca_sur_place' as const,
    source:
      'SPF Finances — seuil SCE/GKS de 25 000 € HTVA sur les services de restaurant et de ' +
      'restauration, hors boissons (voir source complète sur la clé de parametre). Reste a ' +
      "ZÉRO tant qu'il n'y a ni table ni chaise au stand ; le jour ou l'assiette cesse " +
      "d'etre nulle, la caisse certifiee vaut ensuite pour TOUTES les ventes, emporte compris.",
  },
] as const;

export type CompteurSeuilEnrichi = CompteurSeuil & {
  depassementProjete: boolean;
  source: string;
  /**
   * Statut vis-à-vis du régime à DEUX ÉTAGES du formulaire e604B (docs/07-
   * DOCTRINE-ERP-ET-DESIGN.md §6.6) — `null` sur tout seuil SAUF « Franchise
   * TVA ». `depassementProjete` (ci-dessus) dit si la PROJECTION de fin
   * d'année franchira le seuil de 25 000 € ; ceci dit si le CA RÉEL,
   * réalisé À CE JOUR, s'approche ou dépasse le plafond de TOLÉRANCE de
   * 27 500 € (10 % au-delà du seuil) au-delà duquel la franchise est perdue
   * IMMÉDIATEMENT — sans même attendre la fin d'année ni le dépôt du e604B.
   *
   * DÉFAUT CORRIGÉ (mission du 01/08/2026, `echeance_e604b_tolerance_cents`,
   * `packages/core/src/parametres.ts`) : cette clé avait été extraite de la
   * PROSE de `CATALOGUE_ECHEANCES` vers une colonne numérique dédiée, mais
   * n'était lue nulle part (docs/29-VALEURS-EN-DUR.md §6 point 1). Câblée ici
   * en réutilisant `statutParPlafond` (`packages/core/src/affichage.ts`),
   * EXACTEMENT le même mécanisme d'alerte à 80 % que les autres seuils légaux
   * (CLAUDE.md §6) — appliqué à un second plafond, sur la MÊME assiette
   * (CA total).
   */
  toleranceE604b: { readonly plafondCents: number; readonly statut: Statut } | null;
};

export type TableauSeuilsResultat = {
  data: CompteurSeuilEnrichi[];
  meta: {
    annee: number;
    sessionsTenues: number;
    caTransformeCents: number;
    caRevenduCents: number;
    partRevenduBp: number;
    /** Palier d'alerte (8000 = 80 %), lu au catalogue et transmis a l'ecran. */
    seuilAlerteBp: number;
  };
};

/**
 * Compteurs de seuils legaux pour une annee civile.
 *
 * Les sessions ANNULEES sont exclues : elles n'ont produit aucun chiffre
 * d'affaires. Les sessions exclues du modele de prevision, elles, comptent
 * bien — elles ont eu lieu et ont encaisse.
 */
export function tableauSeuils(base: BaseBatte, annee: number): TableauSeuilsResultat {
  const lignes = base
    .select({
      caTotal: sessionMarche.caTotalCents,
      caTransforme: sessionMarche.caTransformeCents,
      caRevendu: sessionMarche.caRevenduCents,
      caSurPlace: sessionMarche.caSurPlaceCents,
    })
    .from(sessionMarche)
    .where(
      and(
        eq(sessionMarche.statut, 'cloturee'),
        sql`substr(${sessionMarche.dateSession}, 1, 4) = ${String(annee)}`,
      ),
    )
    .all();

  const caTotalCents = lignes.reduce((somme, l) => somme + (l.caTotal ?? 0), 0);
  const caTransformeCents = lignes.reduce((somme, l) => somme + (l.caTransforme ?? 0), 0);
  const caRevenduCents = lignes.reduce((somme, l) => somme + (l.caRevendu ?? 0), 0);
  // Assiette du seuil SCE (D-054 bis) : CA de consommation SUR PLACE, jamais le
  // CA total. `?? 0` couvre les sessions closes avant l'existence de la colonne.
  const caSurPlaceCents = lignes.reduce((somme, l) => somme + (l.caSurPlace ?? 0), 0);

  const parametres = lireParametres(base, `${annee}-12-31`);

  // Lu ici et non recu en argument : le nombre de sessions attendues est une
  // valeur METIER, elle n'a rien a faire dans un handler HTTP. Le lire a la
  // meme date que les plafonds garantit qu'une annee passee est projetee avec
  // le rythme qui etait le sien, pas avec celui d'aujourd'hui.
  const sessionsPrevuesDansLAnnee = parametres.entier('seuils_sessions_prevues_par_an');

  /**
   * Revenu net estime de l'exercice, calcule UNE FOIS et seulement s'il sert.
   *
   * `syntheseExercice` relit sessions, depenses et amortissements : l'appeler
   * dans la boucle le referait a chaque seuil. Le calcul reste indicatif —
   * c'est une estimation, pas une declaration (CLAUDE.md §7).
   */
  const assietteRevenuNetUtilisee = SEUILS.some((d) => d.assiette === 'revenu_net');
  const revenuNetCents = assietteRevenuNetUtilisee
    ? syntheseExercice(base, annee).netEstimeCents
    : 0;

  const seuilAlerteBp = parametres.pointsDeBase('seuil_alerte_bp');

  const data = SEUILS.map((definition) => {
    const compteur = projeterSeuil({
      cle: definition.cle,
      libelle: definition.libelle,
      // Chaque seuil est confronte a SON assiette. Les melanger revenait a
      // comparer des euros de chiffre d'affaires a un plafond de revenu (ou,
      // pour le SCE, a un CA qui inclut a tort de l'emporte).
      realiseCents:
        definition.assiette === 'revenu_net'
          ? revenuNetCents
          : definition.assiette === 'ca_sur_place'
            ? caSurPlaceCents
            : caTotalCents,
      plafondCents: parametres.centimes(definition.cle),
      sessionsTenues: lignes.length,
      sessionsPrevuesDansLAnnee,
    });
    return {
      ...compteur,
      depassementProjete: depassementProjete(compteur),
      source: definition.source,
      // Voir le commentaire de `CompteurSeuilEnrichi.toleranceE604b` : le
      // regime a deux etages n'existe que pour la franchise TVA, jamais pour
      // les trois autres seuils (Airbag, cotisation reduite, SCE), qui n'ont
      // pas d'equivalent reglementaire connu.
      toleranceE604b:
        definition.cle === 'seuil_franchise_tva_cents'
          ? {
              plafondCents: parametres.centimes('echeance_e604b_tolerance_cents'),
              statut: statutParPlafond(
                caTotalCents,
                parametres.centimes('echeance_e604b_tolerance_cents'),
                seuilAlerteBp,
              ),
            }
          : null,
    };
  });

  return {
    data,
    meta: {
      annee,
      sessionsTenues: lignes.length,
      caTransformeCents,
      caRevenduCents,
      partRevenduBp: caTotalCents === 0 ? 0 : ratioEnPointsDeBase(caRevenduCents, caTotalCents),
      // Transmis a l'ecran pour qu'il n'ait pas a decider du palier : la valeur
      // est metier, elle vit dans `parametre` (CLAUDE.md §6, alerte a 80 %).
      seuilAlerteBp,
    },
  };
}

export function listerLieux(base: BaseBatte) {
  return base
    .select({
      id: lieuMarche.id,
      nom: lieuMarche.nom,
      heureDebut: lieuMarche.heureDebut,
      heureFin: lieuMarche.heureFin,
      tarifEmplacementCents: lieuMarche.tarifEmplacementCents,
    })
    .from(lieuMarche)
    .where(eq(lieuMarche.actif, true))
    .orderBy(lieuMarche.nom)
    .all();
}

export function listerProduitsVendables(base: BaseBatte) {
  return base
    .select({
      id: produitVente.id,
      nom: produitVente.nom,
      nature: produitVente.nature,
      prixCents: produitVente.prixCents,
      nbCrepes: produitVente.nbCrepes,
      consommationSurPlace: produitVente.consommationSurPlace,
      categorie: produitVente.categorie,
    })
    .from(produitVente)
    .where(eq(produitVente.actif, true))
    .orderBy(produitVente.nom)
    .all();
}
