/**
 * Contrat HTTP des routes `/api/sessions` et `/api/seuils` (Lot 4).
 */

import { z } from 'zod';
import { estJourCivilValide } from '../horodatage.js';
import { schemaNatureProduit } from './referentiel.js';

export const schemaStatutSession = z.enum(['planifiee', 'cloturee', 'annulee']);

export const schemaLieuMarche = z.object({
  id: z.string(),
  nom: z.string(),
  heureDebut: z.string().nullable(),
  heureFin: z.string().nullable(),
  tarifEmplacementCents: z.int().nullable(),
});

/**
 * Produit vendable, pour alimenter la saisie de cloture — les TROIS natures
 * (fiche 16 §2, migration 0023), menu compris (Trou 1, audit du 30/07/2026).
 *
 * `listerProduitsVendables` (`packages/db/src/depots/sessions.ts`) ne filtre
 * déjà PAS `nature` : un menu actif figure donc déjà dans la réponse SQL.
 * C'est CE schéma, trop étroit (deux valeurs), qui la rejetait au parse dès
 * le premier menu actif — `GET /api/produits-vendables` levait alors une
 * erreur Zod et l'écran de clôture devenait inutilisable. Arbitrage : élargir
 * ICI plutôt que filtrer les menus au dépôt — un menu doit être vendable,
 * sinon la fonctionnalité n'a aucun sens.
 *
 * ATTENTION : `nature` porte ici le type COMPLET (`NatureProduitVente`, menu
 * compris), à ne SURTOUT PAS confondre avec `NatureProduit`
 * (`packages/core/src/sessions.ts`, volontairement limité aux deux natures
 * VENDUES). Un menu ne doit JAMAIS atteindre `LigneVente` tel quel — c'est à
 * `apps/web/src/pages/Sessions.tsx` de le garantir à l'écran (voir le
 * rapport de livraison).
 */
export const schemaProduitVendable = z.object({
  id: z.string(),
  nom: z.string(),
  nature: schemaNatureProduit,
  prixCents: z.int(),
  nbCrepes: z.int().nullable(),
  consommationSurPlace: z.boolean(),
  categorie: z.string().nullable(),
});

export const schemaLigneVenteSaisie = z.object({
  produitVenteId: z.string().min(1),
  quantite: z.int().positive(),
  prixUnitaireCents: z.int().nonnegative(),
  creneauHoraire: z.string().nullable().optional(),
});

/**
 * Unite dans laquelle le volume de pate restant est declare. `g` reste
 * accepte par le contrat, mais est refuse au moment de la resolution
 * (`resoudreCrepesDepuisVolumeRestant` cote depot, via `convertir` de
 * `unites.ts`) : aucune densite de pate n'est declaree nulle part dans le
 * modele (CLAUDE.md §3 regle 4), et inventer un facteur serait exactement la
 * conversion silencieuse interdite. Le champ existe pour que l'ecran puisse
 * l'expliquer, pas pour le faire fonctionner en silence.
 */
export const schemaUniteVolumeRestant = z.enum(['ml', 'g']);

export const schemaVolumeRestantSaisi = z.object({
  quantite: z.int().nonnegative(),
  unite: schemaUniteVolumeRestant,
});

/**
 * Relevé de température saisi À LA CLÔTURE (docs/17 fiche 17) : « un registre
 * qu'on remplit ailleurs est un registre qu'on ne remplit pas » (docs/06 §3).
 * Restreint aux deux moments que couvre CET écran — l'arrivée sur le marché et
 * le retour — les trois autres (`depart`, `mi_session`, `stockage`) restent la
 * responsabilité de l'écran Registre AFSCA. `packages/db/src/services/sessions.ts`
 * rattache le relevé à CETTE session (`sessionId`), pas seulement à une date.
 */
export const schemaMomentReleveTemperatureCloture = z.enum(['arrivee', 'retour']);

export const schemaReleveTemperatureSaisieCloture = z.object({
  moment: schemaMomentReleveTemperatureCloture,
  equipement: z.string().min(1, "Indiquez l'équipement mesuré."),
  temperatureC: z.number(),
  /**
   * Obligatoire seulement si le relevé dépasse le seuil — vérifié côté
   * service (`enregistrerReleveTemperature` / `cloturerSession`), à la date en
   * vigueur du paramètre `temperature_max_froid_c`, jamais un nombre en dur.
   */
  actionCorrective: z.string().nullable().optional(),
});

/**
 * Un appareil électrique (`equipement`, fiche 17 — docs/demandes/17-ENERGIE-
 * GAZ-ELECTRICITE-SOLAIRE-EMPREINTE.md, D-055) utilisé pendant CETTE session,
 * avec sa durée d'utilisation en minutes — saisi À LA CLÔTURE, même principe
 * que les relevés de température ci-dessus : « un registre qu'on remplit
 * ailleurs est un registre qu'on ne remplit pas » (docs/06 §3).
 *
 * Défaut corrigé le 30/07/2026 : la table `equipement_session` s'écrivait
 * (`enregistrerUtilisationEquipement`, appelée dans `cloturerSession`) et se
 * lisait déjà (deux routes de l'écran Équipements), mais AUCUN champ de ce
 * nom n'existait ici, ni dans la route de clôture, ni dans le formulaire —
 * le contrat HTTP ne pouvait donc jamais transmettre cette saisie, et le
 * coût d'électricité se lisait zéro pour toujours (un zéro qui se lit
 * « ça ne coûte rien » et qui voulait dire « on n'a jamais pu le saisir »).
 */
export const schemaUtilisationEquipementSaisieCloture = z.object({
  equipementId: z.string().min(1),
  dureeMinutes: z.int().positive(),
});

export const schemaCreationSession = z.object({
  lieuId: z.string().min(1),
  /**
   * Le format ET l'existence au calendrier. `2026-02-30` respectait la forme
   * et n'existe pas : la session s'y rattachait a un jour qui n'a jamais eu
   * lieu, et le releve AFSCA correspondant ne se defend pas devant un
   * inspecteur. Le garde-fou de route empechait le plantage, pas la donnee
   * fausse.
   */
  dateSession: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ, par exemple 2026-07-30.')
    .refine(estJourCivilValide, 'Cette date n’existe pas au calendrier.'),
  fondsCaisseInitialCents: z.int().nonnegative().optional(),
  /**
   * Opportunité (fiche 14) qui MOTIVE cette session dès sa création — un
   * stand d'entreprise, un marché de Noël, une fête médiévale : la session
   * n'existerait pas sans elle. `null`/absent = session régulière, le cas
   * majoritaire. Voir `schemaRattachementEvenementSession` pour le rattacher
   * APRÈS coup, tant que la session n'est pas encore clôturée (D-059).
   */
  evenementId: z.string().min(1).nullable().optional(),
});

/**
 * Corps de `PATCH /sessions/:id/rattacher-evenement` : lie une session déjà
 * créée à l'opportunité qui l'a motivée (fiche 14), tant qu'elle n'est pas
 * encore clôturée — refusé ensuite (`rattacherEvenementSession`,
 * `packages/db/src/services/sessions.ts`) : « le lien doit être posé avant,
 * pas reconstitué » (CLAUDE.md §7), sans quoi le taux de prise mesuré
 * pourrait être choisi APRÈS coup pour correspondre au résultat déjà connu.
 */
export const schemaRattachementEvenementSession = z.object({
  evenementId: z.string().min(1, 'Choisissez une opportunité.'),
});

export type RattachementEvenementSession = z.infer<typeof schemaRattachementEvenementSession>;

/**
 * Saisie de cloture.
 *
 * `especesCompteesCents` inclut le fonds de caisse : c'est ce qu'on compte
 * physiquement au retour. `caEspeces` en est DERIVE cote serveur, il ne se
 * saisit jamais — c'est la correction de l'invariant n°4 de docs/02.
 */
export const schemaClotureSession = z
  .object({
    ventes: z.array(schemaLigneVenteSaisie).min(1, 'Saisissez au moins une ligne de vente.'),
    frais: z.object({
      emplacementCents: z.int().nonnegative(),
      deplacementCents: z.int().nonnegative(),
      gazCents: z.int().nonnegative(),
      diversCents: z.int().nonnegative(),
    }),
    /**
     * Kilomètres RÉELLEMENT parcourus pendant cette session, tournée comprise
     * (domicile -> marché -> éventuellement un autre marché ou un fournisseur
     * -> retour) — D-064, décidée en séance avec le porteur :
     *
     * « Ça dépend, tu dois laisser libre ce champ afin que je puisse par
     * exemple aller du marché à un autre marché ou chez des fournisseurs. »
     *
     * PAS d'interrupteur « aller-retour oui/non » : ce champ reste entièrement
     * LIBRE. Optionnel et nullable : `null`/absent = non renseigné, JAMAIS 0
     * (CLAUDE.md §7 — une valeur inconnue vaut `null`, jamais 0, qui
     * laisserait croire à un déplacement gratuit en carburant et en usure).
     *
     * Un RÉEL et non un entier : c'est une distance lue sur un compteur ou une
     * carte (« 23,4 km »), pas un montant — l'invariant des entiers
     * (CLAUDE.md §3 règle 3) ne porte que sur l'argent, les masses et les
     * volumes.
     *
     * Pré-rempli à l'écran (`apps/web/src/pages/Sessions.tsx`) à 2 × la
     * distance de RÉFÉRENCE du lieu (`lieu_marche.distance_km`) quand elle est
     * connue — légitime ici, contrairement à la distance du lieu elle-même
     * (D-064 point 2, refusée explicitement), car il dérive d'un chiffre que
     * le porteur a lui-même saisi, pas d'une estimation calculée.
     */
    distanceReelleKm: z.number().nullable().optional(),
    fondsCaisseInitialCents: z.int().nonnegative(),
    especesCompteesCents: z.int().nonnegative(),
    caCarteCents: z.int().nonnegative(),
    /**
     * OPTIONNEL : dérivé des productions rattachées quand il y en a. Ne le
     * renseigner que pour des crêpes faites hors application — le renseigner en
     * contradiction avec les productions fait échouer la clôture, volontairement.
     *
     * Exclusif avec `volumeRestantSaisi` : deux façons de clôturer, au choix,
     * jamais les deux à la fois (demande du porteur).
     */
    crepesProduites: z.int().nonnegative().optional(),
    /**
     * Deuxième façon de déclarer la production : le volume de pâte MESURÉ
     * restant dans le bac, plutôt qu'un nombre de crêpes recompté à la main.
     * Les crêpes produites en sont DÉDUITES (`resoudreCrepesDepuisVolumeRestant`),
     * à partir du volume et des crêpes des productions rattachées à cette
     * session. Un écart avec vendues + invendues + cassées n'est alors jamais
     * refusé : c'est une mesure, pas une saisie contradictoire.
     */
    volumeRestantSaisi: schemaVolumeRestantSaisi.nullable().optional(),
    /**
     * Tickets encaissés, relevés sur le terminal. **Optionnel** : sans lui, le
     * panier moyen reste `null` au lieu d'être calculé sur des articles — ce qui
     * le divisait par deux dès qu'un client prenait deux produits.
     */
    nbTickets: z.int().positive().nullable().optional(),
    /**
     * Relevés de température (docs/17 fiche 17), **optionnels** : un relevé
     * qui manque reste manquant, rien ici ne le force ni ne le reconstitue
     * (CLAUDE.md §7). Zéro, un ou deux éléments (arrivée, retour) — jamais
     * plus d'un par moment, mais ce n'est pas au contrat de l'interdire, c'est
     * une convention de l'écran.
     */
    relevesTemperature: z.array(schemaReleveTemperatureSaisieCloture).optional(),
    /**
     * Équipements électriques utilisés pendant la session, avec leur durée
     * (fiche 17). **Optionnel** : un lieu sans électricité
     * (`lieu_marche.facturation_electricite = 'aucune'`) n'en fournit aucun —
     * l'écran ne doit alors en proposer aucun (`apps/web/src/pages/
     * Sessions.tsx`). Absent plutôt qu'un tableau vide quand rien n'est
     * utilisé, même convention que `relevesTemperature` ci-dessus.
     */
    equipementsUtilises: z.array(schemaUtilisationEquipementSaisieCloture).optional(),
    crepesInvendues: z.int().nonnegative(),
    crepesCassees: z.int().nonnegative(),
    heureDebutReelle: z.string().nullable().optional(),
    heureFinReelle: z.string().nullable().optional(),
    notesQualitatives: z.string().nullable().optional(),
    exclureDuModele: z.boolean().optional(),
    motifExclusion: z.string().nullable().optional(),
  })
  .refine(
    (valeur) =>
      !(
        valeur.crepesProduites !== undefined &&
        valeur.volumeRestantSaisi !== null &&
        valeur.volumeRestantSaisi !== undefined
      ),
    {
      message:
        'Choisissez un seul mode de saisie de la production : le nombre de crêpes produites, ' +
        'ou le volume de pâte restant — pas les deux à la fois.',
      path: ['crepesProduites'],
    },
  );

/** Enveloppes de liste, comme toutes les autres routes de liste du produit. */
export const schemaListeLieux = z.object({
  data: z.array(schemaLieuMarche),
  meta: z.object({ total: z.int() }),
});

export const schemaListeProduitsVendables = z.object({
  data: z.array(schemaProduitVendable),
  meta: z.object({ total: z.int() }),
});

export const schemaSessionResume = z.object({
  id: z.string(),
  numero: z.string(),
  /** Permet de retrouver le lieu sans se fier au nom, qui n'est pas une clé. */
  lieuId: z.string(),
  lieuNom: z.string(),
  dateSession: z.string(),
  statut: schemaStatutSession,
  caTotalCents: z.int().nullable(),
  margeNetteCents: z.int().nullable(),
  /** Vendu / produit, en points de base. `null` avant clôture. */
  tauxEcoulementBp: z.int().nullable(),
  ecartCaisseCents: z.int().nullable(),
  crepesVendues: z.int(),
  exclureDuModele: z.boolean(),
  /**
   * Opportunité (fiche 14) qui a motivé cette session — `null` = session
   * régulière, le cas majoritaire et il le restera. Voir
   * `schemaRattachementEvenementSession` pour la lier après coup.
   */
  evenementId: z.string().nullable(),
  /** Nom de l'opportunité ci-dessus, dénormalisé pour l'affichage — `null` en même temps que `evenementId`. */
  evenementNom: z.string().nullable(),
});

/**
 * Relevé météo FIGÉ sur une session (`session_marche.meteo_prevue` /
 * `meteo_reelle`, audit du 30/07/2026 — mission « météo prévue et réelle
 * d'une session ») : une PHOTOGRAPHIE d'une ligne de `meteo_observation`
 * prise à la CLÔTURE (`packages/db/src/services/sessions.ts::cloturerSession`),
 * jamais recalculée à la lecture, jamais un lien vivant vers la table météo —
 * qui, elle, continue d'archiver toutes les révisions par horizon (D-058).
 *
 * DISTINCT du prédicteur « écart météo prévue/réalisée » du moteur de
 * prévision (`packages/core/src/prevision/ecart-meteo-prevue-realisee.ts`),
 * qui lit `meteo_observation` DIRECTEMENT par (lieu, date) via
 * `pairesMeteoDuLieu` (`packages/db/src/depots/previsions.ts`) et n'a donc
 * besoin ni de ce champ ni d'un lien vers la session : ce relevé-ci ne sert
 * QUE l'affichage et l'audit d'UNE session — « qu'annonçait-on ce jour-là,
 * qu'a-t-il fait vraiment ? ».
 */
export const schemaMeteoSessionReleve = z.object({
  temperatureC: z.number().nullable(),
  temperatureRessentieC: z.number().nullable(),
  precipitationsMm: z.number().nullable(),
  probabilitePluieBp: z.int().nullable(),
  ventKmh: z.number().nullable(),
  couvertureNuageuseBp: z.int().nullable(),
  codeMeteo: z.int().nullable(),
  /**
   * Jours entre la récupération du relevé et le jour observé (D-058) : `0`
   * pour `meteoReelle` (observée le jour même, par construction — voir
   * `horizonJoursReleve`, `packages/db/src/depots/previsions.ts`). Pour
   * `meteoPrevue`, l'horizon RETENU parmi les révisions disponibles au
   * moment de la clôture — jamais `0` : voir le commentaire au point de
   * calcul dans `cloturerSession` pour pourquoi ce n'est délibérément jamais
   * la dernière prévision connue (« le matin même »), mais celle la plus
   * proche de J-1 — la prévision sur laquelle la décision de production a
   * réellement pu se prendre.
   */
  horizonJours: z.int().nullable(),
});
export type MeteoSessionReleve = z.infer<typeof schemaMeteoSessionReleve>;

/**
 * Une ligne de `session_frais` : le détail d'un frais de session, avec son
 * éventuel justificatif — câblage manquant (audit du 30/07/2026).
 *
 * `lireSessionDetail` (`packages/db/src/depots/sessions.ts`) renvoie déjà
 * `fraisDetail` depuis `listerFraisSession`, mais ce schéma ne le déclarait
 * pas : `schemaSessionDetail.parse(...)` le TRONQUAIT DONC SILENCIEUSEMENT
 * (Zod ignore par défaut les clés qu'il ne connaît pas), pour une donnée déjà
 * écrite à chaque clôture et jamais relue par personne côté API.
 */
export const schemaFraisSessionLigne = z.object({
  id: z.string(),
  libelle: z.string(),
  categorie: z.string(),
  montantCents: z.int(),
  justificatifPath: z.string().nullable(),
});

export const schemaSessionDetail = schemaSessionResume.extend({
  heureDebutReelle: z.string().nullable(),
  heureFinReelle: z.string().nullable(),
  fondsCaisseInitialCents: z.int(),
  especesCompteesCents: z.int().nullable(),
  caEspecesCents: z.int().nullable(),
  caCarteCents: z.int().nullable(),
  caTransformeCents: z.int().nullable(),
  caRevenduCents: z.int().nullable(),
  caSurPlaceCents: z.int().nullable(),
  coutMatiereCents: z.int().nullable(),
  commissionCarteCents: z.int().nullable(),
  fraisEmplacementCents: z.int(),
  fraisDeplacementCents: z.int(),
  fraisGazCents: z.int(),
  fraisDiversCents: z.int(),
  /**
   * Coût d'électricité RETENU dans la marge (fiche 17, `resoudreCoutEnergieSession`
   * — `@batte/core`) — cas 3 SEUL (facturation au compteur) : TOUJOURS 0 sur
   * un lieu sans électricité ou déjà facturé au forfait/compris (double
   * comptage évité), et TOUJOURS 0 (jamais deviné) tant qu'aucune durée
   * d'équipement n'a été enregistrée pour cette session. Reconstruit à CHAQUE
   * lecture depuis le ledger `session_frais` (catégorie `energie`), comme
   * `fraisDetail` ci-dessous — jamais recalculé depuis les paramètres ou le
   * lieu ACTUELS, qui peuvent avoir changé depuis la clôture.
   */
  fraisEnergieCents: z.int(),
  /**
   * Kilomètres RÉELLEMENT parcourus pendant la tournée (D-064), saisis à la
   * clôture. `null` = non renseigné, JAMAIS 0 (CLAUDE.md §7 — un zéro
   * laisserait croire à une session sans déplacement, donc gratuite en
   * carburant et en usure). Trou 1 (audit du 30/07/2026) : le champ était
   * saisi, stocké, mais absent de ce schéma — Zod tronque silencieusement les
   * clés qu'il ne connaît pas, donc une session close n'affichait jamais le
   * kilométrage saisi.
   */
  distanceReelleKm: z.number().nullable(),
  /**
   * Imputation FIGÉE de la tournée réelle entre la session et les achats
   * (D-064 point 4, `imputationTourneeDeplacement` —
   * `packages/core/src/deplacement.ts`), persistée à la clôture
   * (`services/sessions.ts::cloturerSession`, migration 0027) et JAMAIS
   * recalculée à la lecture : l'un de ses intrants
   * (`coutKilometriqueRetenu` en mode « mesure ») est une moyenne GLOBALE
   * SANS DATE DE VALIDITÉ qui grossit à chaque nouvelle dépense de carburant
   * — la recalculer ici ferait dériver le partage d'une session close il y a
   * des mois à chaque donnée future, exactement la pièce comptable qui « se
   * réécrit toute seule » que la règle n°7 du §3 de CLAUDE.md interdit (voir
   * `cloturerSession` pour le raisonnement complet, même doctrine que
   * `coutMatiereReelCents`, D-038).
   *
   * `null` partout = pas calculable (distance réelle non saisie, ou distance
   * de référence du lieu inconnue pour séparer les deux parts) — JAMAIS 0,
   * qui laisserait croire à une tournée ou un détour gratuits.
   */
  coutDeplacementReelSessionCents: z.int().nullable(),
  /** Part causée par un détour réel (fournisseur, second marché) — jamais négative. */
  coutDeplacementReelDetourAchatsCents: z.int().nullable(),
  /** Total réel de la tournée, avant séparation des deux parts ci-dessus. */
  coutDeplacementReelTotalCents: z.int().nullable(),
  crepesProduites: z.int(),
  /**
   * Comment `crepesProduites` a été obtenu (D-057) : `'crepes'` compté à la
   * main, `'volume'` DÉDUIT d'une mesure de pâte restante. `null` sur les
   * sessions closes avant l'existence de la colonne — jamais à interpréter
   * comme `'crepes'` : `null` veut dire « on ne sait pas », pas « compté ».
   */
  modeCloture: z.enum(['crepes', 'volume']).nullable(),
  /**
   * Volume de pâte MESURÉ restant dans le bac à la clôture, en millilitres —
   * mode `'volume'` uniquement. `null` en mode `'crepes'` et sur les sessions
   * closes avant la colonne. Le détail du calcul (volume produit, volume
   * consommé) n'est PAS stocké : il se recalcule depuis les productions
   * rattachées si besoin — seule la mesure se conserve.
   */
  volumeRestantMesureMl: z.int().nonnegative().nullable(),
  crepesInvendues: z.int(),
  crepesCassees: z.int(),
  margeBruteCents: z.int().nullable(),
  /** `null` quand la durée est inconnue : on n'invente pas un dénominateur. */
  margeParHeureCents: z.int().nullable(),
  /** CA / tickets. `null` tant que les tickets ne sont pas comptés. */
  panierMoyenCents: z.int().nullable(),
  /** CA / articles. Toujours calculable — à ne pas confondre avec le panier. */
  prixMoyenParArticleCents: z.int().nullable(),
  /** Matière du TRANSFORME (production + garnitures) / crêpes vendues.
   *  Comparable aux 0,33-0,45 €/crêpe de CLAUDE.md §6. */
  coutMatiereParCrepeCents: z.int().nullable(),
  /** Matière du transforme + frais + commission / crêpes vendues. Exclut
   *  volontairement le coût des marchandises REVENDUES (docs/17 fiche 12) :
   *  un pot de sirop revendu n'a rien à voir avec une crêpe. */
  coutCompletParCrepeVendueCents: z.int().nullable(),
  /**
   * Météo FIGÉE à la clôture (voir `schemaMeteoSessionReleve` ci-dessus) —
   * `null` tant qu'aucun relevé exploitable n'existait dans
   * `meteo_observation` pour le lieu et la date de cette session : JAMAIS un
   * relevé reconstitué après coup (CLAUDE.md §7).
   */
  meteoPrevue: schemaMeteoSessionReleve.nullable(),
  meteoReelle: schemaMeteoSessionReleve.nullable(),
  /**
   * Date de clôture RÉELLE (ISO 8601 UTC), distincte de `statut === 'cloturee'`
   * qui dit SEULEMENT que la session l'est, jamais QUAND. Écrite depuis
   * toujours à la clôture (`services/sessions.ts::cloturerSession`), mais
   * absente de ce schéma jusqu'à cet audit : Zod tronque silencieusement les
   * clés qu'il ne connaît pas (même défaut que `distanceReelleKm`, Trou 1).
   * `null` = session pas encore clôturée.
   */
  dateCloture: z.string().nullable(),
  notesQualitatives: z.string().nullable(),
  motifExclusion: z.string().nullable(),
  ventes: z.array(
    z.object({
      produitVenteId: z.string(),
      nomProduit: z.string(),
      quantite: z.int(),
      prixUnitaireCents: z.int(),
      montantCents: z.int(),
      creneauHoraire: z.string().nullable(),
    }),
  ),
  /** Détail des frais, catégorie par catégorie (voir `schemaFraisSessionLigne` ci-dessus). */
  fraisDetail: z.array(schemaFraisSessionLigne),
});

export const schemaListeSessions = z.object({
  data: z.array(schemaSessionResume),
  meta: z.object({ total: z.int() }),
});

export const schemaAnnulationSession = z.object({
  motif: z.string().min(1, 'Indiquez pourquoi cette session est annulée.'),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Seuils legaux
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Statut d'un seuil face à son plafond — mêmes trois valeurs que `Statut`
 * (`packages/core/src/affichage.ts`, `statutParPlafond`), redéclarées ici en
 * Zod plutôt qu'importées : ce contrat ne peut pas dépendre d'un module de
 * calcul de `packages/core` racine sans créer une dépendance croisée entre
 * la frontière HTTP et la logique pure (même raison qui fait dupliquer
 * `coutsDeReference` entre deux dépôts, `packages/db/src/depots/recettes.ts`
 * et `nomenclature-vente.ts`).
 */
export const schemaStatutSeuil = z.enum(['conforme', 'alerte', 'depassement']);

/**
 * Statut du régime à DEUX ÉTAGES du formulaire e604B (docs/07 §6.6) : au-delà
 * de 25 000 € de CA on sort de la franchise TVA, mais une TOLÉRANCE existe
 * jusqu'à 27 500 € (`echeance_e604b_tolerance_cents`, 10 % au-delà du seuil),
 * plafond au-delà duquel la franchise est perdue IMMÉDIATEMENT — sans
 * attendre la fin d'année ni le dépôt du e604B.
 *
 * `null` sur les trois seuils SANS régime à deux étages connu (Airbag,
 * cotisation réduite, SCE) : ce n'est PAS un cinquième seuil indépendant,
 * c'est un QUALIFICATIF de la seule ligne « Franchise TVA ».
 *
 * AJOUTÉ le 01/08/2026 : `CompteurSeuilEnrichi.toleranceE604b`
 * (`packages/db/src/depots/sessions.ts:460,554`) était déjà calculé — mais
 * absent de ce schéma. Ce schéma n'étant pas `.strict()`, la route le
 * supprimait donc SILENCIEUSEMENT à la frontière HTTP : aucune erreur 422,
 * juste une perte muette (même défaut que `numeroLotPate`, découvert ce
 * même jour sur le chemin de traçabilité aval — le dépôt calcule, personne
 * ne voit, rien ne le dit).
 */
export const schemaToleranceE604b = z
  .object({
    plafondCents: z.int(),
    statut: schemaStatutSeuil,
  })
  .nullable();

export const schemaCompteurSeuil = z.object({
  cle: z.string(),
  libelle: z.string(),
  realiseCents: z.int(),
  plafondCents: z.int(),
  partBp: z.int(),
  /** `null` si l'historique est trop court pour projeter honnêtement. */
  projectionFinAnneeCents: z.int().nullable(),
  /** Alerte sur la TRAJECTOIRE, pas sur le pourcentage instantané. */
  depassementProjete: z.boolean(),
  source: z.string(),
  /** Voir `schemaToleranceE604b` : `null` sauf sur la ligne « Franchise TVA ». */
  toleranceE604b: schemaToleranceE604b,
});

export const schemaTableauSeuils = z.object({
  data: z.array(schemaCompteurSeuil),
  meta: z.object({
    annee: z.int(),
    sessionsTenues: z.int(),
    /** Ventilation indispensable : les seuils portent sur le CA, pas la marge. */
    caTransformeCents: z.int(),
    caRevenduCents: z.int(),
    partRevenduBp: z.int(),
    /**
     * Part d'un plafond à partir de laquelle l'écran doit alerter (8000 = 80 %).
     *
     * Exposé pour que l'écran ne décide plus lui-même : il n'affichait que
     * « dépassement » ou « conforme », donc un compteur à **85 % du seuil de
     * franchise TVA s'affichait en vert**, alors que CLAUDE.md §6 demande une
     * alerte à 80 %. Le paramètre existait, personne ne le lisait.
     */
    seuilAlerteBp: z.int(),
  }),
});

export type LieuMarcheContrat = z.infer<typeof schemaLieuMarche>;
export type ListeLieux = z.infer<typeof schemaListeLieux>;
export type ListeProduitsVendables = z.infer<typeof schemaListeProduitsVendables>;
export type AnnulationSession = z.infer<typeof schemaAnnulationSession>;
export type ProduitVendable = z.infer<typeof schemaProduitVendable>;
export type SessionResume = z.infer<typeof schemaSessionResume>;
export type FraisSessionLigneContrat = z.infer<typeof schemaFraisSessionLigne>;
/**
 * Reponse de cloture : le detail de la session, PLUS les ecarts de stock
 * constates sur les produits revendus.
 *
 * L'ecart n'empeche jamais la cloture — la vente a eu lieu — mais il doit etre
 * VU : c'est le signal qu'un inventaire est necessaire (D-037).
 */
export const schemaEcartStockVente = z.object({
  ingredientId: z.string(),
  nomIngredient: z.string(),
  quantiteManquante: z.int().positive(),
});

/**
 * Detail du calcul quand `crepesProduites` vient d'etre DEDUIT d'un volume
 * mesure (`volumeRestantSaisi`) plutot que saisi directement. `null` quand la
 * clôture a utilisé l'autre mode — jamais une clé absente (même convention
 * que `ecartsStock`), pour que l'écran n'ait pas à deviner la différence
 * entre « pas de résolution par volume » et « pas encore regardé ».
 */
export const schemaResolutionVolume = z.object({
  volumeProduitMl: z.int(),
  volumeRestantMl: z.int(),
  /** Volume total disparu du bac : cuit en crêpes ET vendu tel quel (fiche 15 §5.1). */
  volumeConsommeMl: z.int(),
  /**
   * Part de `volumeConsommeMl` vendue DIRECTEMENT en pâte (bouteille, pot),
   * retranchée avant la conversion en crêpes. `0` tant qu'aucun produit vendu
   * n'est identifié comme « pâte vendue au volume », ou tant que son volume
   * par unité n'est pas connu (voir `estPateVendueAuVolume` dans
   * `@batte/core`) — jamais `null` : c'est une somme d'entiers déjà connus,
   * pas une inconnue.
   */
  volumePateVendueMl: z.int(),
});

/**
 * Imputation d'une TOURNÉE réelle entre la session et les achats (D-064
 * point 4, `imputationTourneeDeplacement` — `packages/core/src/deplacement.ts`).
 *
 * Trou 2 (audit du 30/07/2026, refermé le même jour) : la fonction existait,
 * testée, et aucun code de production ne l'appelait ; branchée depuis dans
 * `cloturerSession`, mais son résultat restait éphémère (exposé uniquement
 * ici, jamais persisté). La migration 0027 (porteur) a depuis ajouté trois
 * colonnes miroir sur `session_marche` — voir `coutDeplacementReelSessionCents`
 * / `coutDeplacementReelDetourAchatsCents` / `coutDeplacementReelTotalCents`
 * sur `schemaSessionDetail` ci-dessus, désormais persistées à la clôture
 * (`services/sessions.ts::cloturerSession`) et donc rejouables sur un `GET`
 * ultérieur — à la différence de `resolutionVolume` ci-dessous, qui reste
 * elle éphémère.
 *
 * Ce schéma-ci RESTE sur la réponse de clôture (`schemaResultatCloture`), en
 * plus de `schemaSessionDetail` : un simple miroir de commodité pour le
 * bandeau de confirmation affiché juste après l'enregistrement
 * (`apps/web/src/pages/Sessions.tsx`) — les deux portent toujours la même
 * valeur, calculée UNE seule fois à la clôture.
 */
export const schemaImputationDeplacement = z.object({
  /**
   * Ce que CETTE session aurait coûté SEULE (2 × la distance de référence du
   * lieu). `null` : distance réelle non saisie, OU distance de référence du
   * lieu inconnue (voir la doc de `imputationTourneeDeplacement`).
   */
  coutSessionCents: z.int().nullable(),
  /**
   * Kilomètres AU-DELÀ de la session seule, causés par un détour réel
   * (un autre marché ou un fournisseur, D-064) — jamais négatif. `null` dans
   * les mêmes cas que `coutSessionCents`.
   */
  coutDetourAchatsCents: z.int().nullable(),
  /**
   * Coût réel total de la tournée, avant séparation des deux parts
   * ci-dessus. Connu dès que la distance réelle est saisie, même quand le
   * lieu n'a pas de distance de référence : c'est la SÉPARATION qui devient
   * alors impossible, pas la mesure du total.
   */
  coutTotalReelCents: z.int().nullable(),
});

export const schemaResultatCloture = schemaSessionDetail.extend({
  ecartsStock: z.array(schemaEcartStockVente),
  resolutionVolume: schemaResolutionVolume.nullable(),
  imputationDeplacement: schemaImputationDeplacement,
  /**
   * Avertissement affichable tel quel, juste après l'enregistrement (fiche
   * 17) — `null` quand le coût d'électricité retenu est une valeur CERTAINE
   * (un coût réellement mesuré, ou un zéro certain : aucune électricité sur ce
   * lieu, ou déjà comptée dans l'emplacement/le forfait). Non-`null` quand ce
   * coût, qui pourrait être réel, a été compté 0 PAR PRUDENCE faute de donnée
   * (mode ou prix non paramétré, ou aucune durée d'équipement enregistrée) —
   * voir `resoudreCoutEnergieSession` (`@batte/core`). ÉPHÉMÈRE, comme
   * `resolutionVolume` ci-dessus : pas une pièce comptable, seulement un
   * rappel affiché une fois, jamais reconstitué en rouvrant la session plus
   * tard.
   */
  avertissementEnergie: z.string().nullable(),
  /**
   * Avertissement : du transformé a été vendu cette session, mais AUCUNE
   * source de coût n'a été retenue pour lui — ni la production/garnitures
   * (`coutMatiereTransformeCents`), ni la nomenclature de VENTE d'un
   * transformé À LA DEMANDE (fiche 15, le café) — la marge brute affichée
   * compte alors ce chiffre d'affaires sans en retrancher la matière (défaut
   * trouvé en audit, 30/07/2026, `coutMatiereTransformeSuspect` —
   * `@batte/core` — pour le seuil de déclenchement et sa justification
   * complète). C'est le trou SYMÉTRIQUE de celui déjà corrigé côté
   * revendu/garnitures/composants, protégé par `ecartsStock` ci-dessus, mais
   * qui ne dit rien d'une production simplement absente.
   *
   * `null` dans les TROIS cas suivants, qu'il ne faut JAMAIS confondre : un
   * coût matière transformé réellement retenu (même partiel) ; un coût de
   * composants de vente réellement retenu (même partiel — un transformé À LA
   * DEMANDE a bien un coût matière, simplement compté dans cet autre panier) ;
   * OU une session qui n'a vendu QUE du revendu — un coût transformé nul y est
   * alors LA VÉRITÉ, pas une anomalie. ÉPHÉMÈRE, comme `avertissementEnergie`
   * ci-dessus : pas une pièce comptable, seulement un rappel affiché une
   * fois, jamais reconstitué en rouvrant la session plus tard.
   */
  avertissementCoutMatiereTransforme: z.string().nullable(),
});

export type SessionDetail = z.infer<typeof schemaSessionDetail>;
export type EcartStockVente = z.infer<typeof schemaEcartStockVente>;
export type ResolutionVolumeContrat = z.infer<typeof schemaResolutionVolume>;
export type ImputationDeplacementContrat = z.infer<typeof schemaImputationDeplacement>;
export type ResultatCloture = z.infer<typeof schemaResultatCloture>;
export type ListeSessions = z.infer<typeof schemaListeSessions>;
export type ClotureSession = z.infer<typeof schemaClotureSession>;
export type UtilisationEquipementSaisieCloture = z.infer<
  typeof schemaUtilisationEquipementSaisieCloture
>;
export type StatutSeuil = z.infer<typeof schemaStatutSeuil>;
export type ToleranceE604bContrat = z.infer<typeof schemaToleranceE604b>;
export type CompteurSeuilContrat = z.infer<typeof schemaCompteurSeuil>;
export type TableauSeuils = z.infer<typeof schemaTableauSeuils>;
