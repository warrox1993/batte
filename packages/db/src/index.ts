export { config } from './config.js';
export { creerBase, fermerBase, sqliteBrut, schema, type BaseBatte } from './client.js';
export { migrer } from './migrer.js';
export { estModulePrincipal } from './module-principal.js';
export {
  purger,
  // La RESTAURATION n'existait pas : on sauvegardait depuis le Lot 0 sans
  // jamais avoir verifie qu'on savait revenir en arriere. D-033 avait deja
  // montre qu'une archive pouvait etre silencieusement incomplete — le pire
  // mode de defaillance d'un registre AFSCA, puisqu'on ne le decouvre qu'en
  // restaurant.
  restaurer,
  sauvegarder,
  type OptionsPurge,
  type OptionsRestauration,
  type ResultatRestauration,
  type ResultatSauvegarde,
} from './sauvegarde.js';
export {
  ajouterVersionParametre,
  corrigerParametre,
  lireParametres,
  listerParametres,
} from './depots/parametres.js';
export {
  chargerRecettePourCalcul,
  // Cout de revient d'un PRODUIT VENDU : part de pate + garnitures (D-053).
  // Sans elles, le cout matiere ignorait la garniture et sous-estimait de
  // ~0,073 EUR par crepe.
  coutRevientProduit,
  lireRecetteDetail,
  listerCoutsRevientProduits,
  listerRecettes,
} from './depots/recettes.js';
export {
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
  type ConditionnementLigne,
  type IngredientCompletLigne,
  type LieuCompletLigne,
  type RecetteReferentielLigne,
  type ResultatNouveauTarif,
  type ResultatVersionRecetteDepot,
} from './depots/referentiel-ecriture.js';
export {
  changerActiviteFournisseur,
  changerActiviteProduit,
  creerFournisseur,
  creerProduit,
  listerFournisseurs,
  listerProduits,
  modifierFournisseur,
  modifierProduit,
} from './depots/referentiel.js';
export { SERIES, allouerNumero, lireSeries, type NatureDocument } from './depots/numerotation.js';
// Etat DERIVE du parcours de demarrage : aucune table, aucune persistance. Une
// case a cocher est une declaration et peut mentir ; huit questions posees a la
// base ont une reponse vraie a chaque instant (docs/06, encadre du 31/07/2026).
export { etatDemarrage } from './depots/demarrage.js';
export {
  annulerDepense,
  calculerImpactVerrouillagePeriode,
  cloturerPeriode,
  enregistrerDepense,
  enregistrerImmobilisation,
  estimerMontantEcheance,
  listerDepenses,
  listerEcheances,
  listerImmobilisations,
  listerPeriodes,
  marquerEcheanceFaite,
  rouvrirPeriode,
  seedEcheances,
  mesureCarburant,
  syntheseExercice,
  ventesParCreneauBrutes,
  verrouillerPeriode,
  type CarburantMesure,
  type CategorieDepense,
  type DepenseLigne,
  type EcheanceLigne,
  type EntreeDepense,
  type EntreeImmobilisation,
  type ImmobilisationDetail,
  type ImpactVerrouillagePeriode,
  type PeriodeLigne,
  type StatutEcheance,
  type StatutPeriode,
  type SyntheseExercice,
} from './depots/comptabilite.js';
export {
  // Veille concurrentielle (fiche 08). Ce module n'alimente JAMAIS la prevision :
  // un concurrent deplace la REPARTITION de la clientele entre vendeurs, pas la
  // demande TOTALE du marche. L'ecran le dit lui-meme, en permanence.
  ajouterObservationConcurrent,
  ajouterProduitConcurrent,
  changerActiviteConcurrent,
  comparateurPrix,
  creerConcurrent,
  dernierPrixParProduit,
  lireConcurrentDetail,
  listerConcurrents,
  modifierConcurrent,
  mouvementsPrixConcurrents,
  moyenneCentsEntiere,
  type ComparateurNotreProduit,
  type ComparateurPrixConcurrent,
  type ComparateurResultat,
  type ConcurrentDetail,
  type ConcurrentLigne,
  type ConcurrentObservationLigne,
  type ConcurrentProduitLigne,
  type DernierPrixProduit,
  type EntreeConcurrentObservation,
  type EntreeConcurrentProduit,
  type FiltreConcurrents,
  type MouvementPrixLigne,
  type SaisieConcurrent,
} from './depots/concurrents.js';
export {
  // Propositions d'evenements trouvees par l'IA (fiche 05). Elles vivent dans la
  // table `evenement` avec `source='ia'` et `valide_par_humain=false` : rien
  // n'entre dans le calcul de prevision sans un clic de validation humaine.
  creerPropositionEvenementIa,
  lieuPourRechercheEvenements,
  listerLieuxPourRechercheEvenements,
  listerPropositionsEnAttente,
  nombrePropositionsEnAttente,
  reglerRayonRechercheEvenements,
  rejeterPropositionEvenement,
  validerPropositionEvenement,
  type AjustementValidation,
  type EntreePropositionEvenementIa,
  type LieuPourRechercheEvenements,
  type PropositionEvenementLigne,
} from './depots/evenements-decouverte.js';
export {
  // Nomenclature de VENTE : ce qu'un produit consomme au moment ou il est
  // VENDU, par opposition a la recette, consommee a la PRODUCTION. Un seul
  // concept couvre le cafe (qui n'a pas de lot de production), les serviettes
  // et gobelets (categorie `consommable` qui existait sans que RIEN ne la
  // consomme), les contenants et les toppings vendus entiers.
  changerActiviteComposantVente,
  creerComposantVente,
  lireComposantVente,
  listerComposantsDuProduit,
  modifierComposantVente,
  type ComposantVenteLigne,
} from './depots/nomenclature-vente.js';
export {
  // Marge nette ATTENDUE par lieu (fiche 13). Le moteur disait « produis 203
  // crepes » ; il peut desormais dire « ce marche te rapportera 180 EUR nets,
  // cet autre 165 ». Seuls les couts qui VARIENT selon le lieu y entrent : y
  // mettre les charges fixes ecraserait l'ecart qu'on cherche a voir.
  coutGazMoyenParCrepe,
  lieuxActifsPourRentabilite,
  mesureCoutVehicule,
  type CoutGazMoyen,
  type LieuPourRentabilite,
} from './depots/lieux-rentabilite.js';
export {
  // Equipements electriques du stand (fiche 17). Deux grandeurs a ne pas
  // confondre : la PUISSANCE s'additionne a l'instant et decide si ca
  // disjoncte ; l'ENERGIE s'additionne dans le temps et decide de ce qu'on
  // paie. Et le prix du kWh ne s'applique QUE si le lieu facture au compteur.
  changerActiviteEquipement,
  creerEquipement,
  enregistrerUtilisationEquipement,
  lieuxActifsPourDiagnosticPuissance,
  listerEquipements,
  modifierEquipement,
  utilisationsEquipementsSession,
  type EntreeUtilisationEquipement,
  type EquipementLigne,
  type LieuPourDiagnosticPuissance,
  type UtilisationEquipementLigne,
} from './depots/equipements.js';
export {
  // Opportunites : des evenements ou l'on SE REND, par opposition aux
  // evenements-FACTEURS qui modulent une session existante. `impact_estime_bp`
  // y est fige au NEUTRE : sans ca, une opportunite contaminerait le facteur
  // d'une session reguliere tombant la meme date.
  creerOpportunite,
  listerOpportunitesActives,
  rattacherLieuOpportunite,
  rejeterOpportunite,
  sessionsEntrepriseFermees,
  type EntreeOpportunite,
  type ObservationEntrepriseFermee,
  type OpportuniteCandidate,
} from './depots/opportunites.js';
export {
  // Succes et niveaux (fiche 18). Ce sont des VUES recalculees, jamais un etat
  // stocke : sinon une session annulee laisserait un badge acquis a tort. Le
  // niveau de CA est structurellement livre AVEC les seuils legaux — feliciter
  // la croissance sans dire ce qu'elle implique ferait se contredire deux
  // ecrans de la meme application.
  calculerSucces,
  type NiveauChiffreAffaires,
  type ResultatAnticipationSeuilNiveau,
  type ResultatSerieAxe,
  type ResultatSucces,
  // Objectifs (budget, fiche 18 §4) — a NE PAS confondre avec les succes
  // ci-dessus, et c'est la distinction que la fiche elle-meme fait : un succes
  // est une VUE recalculee, un objectif est une DONNEE saisie par le porteur.
  // Deux audits se sont contredits sur ce point le 30/07/2026 parce qu'ils
  // regardaient chacun une moitie : les succes etaient bien cabl es de bout en
  // bout, les objectifs n'existaient qu'a l'etat de moteur pur.
  //
  // Correction ou abandon par CONTRE-ECRITURE, jamais par suppression (§3
  // regle 7) : il n'y a volontairement pas de fonction « modifier ».
  annulerObjectif,
  creerObjectif,
  listerObjectifs,
  type EntreeObjectif,
  type ObjectifLigne,
} from './depots/objectifs.js';
export {
  // Menus (fiche 16). La remise d'un menu est REPARTIE entre ses composants :
  // sans ca, la ventilation transforme/revendu serait fausse — et elle alimente
  // les compteurs de seuils legaux, ou la revente pese ~2,6 fois plus de CA
  // pour une meme marge. Un menu non ventile fausse le compteur de franchise TVA.
  calculerVentilationMenu,
  changerActiviteCompositionMenu,
  creerCompositionMenu,
  lireCompositionMenu,
  listerCompositionMenu,
  listerMenus,
  modifierCompositionMenu,
  type CompositionMenuLigne,
  type MenuLigne,
  type VentilationMenuLigne,
} from './depots/menus.js';
export {
  journaliser,
  listerJournalAudit,
  tablesTracees,
  type ActionAudit,
  type EntreeAudit,
  type FiltreJournalAudit,
  type InstantaneAudit,
  type LigneJournalAudit,
} from './depots/audit.js';
export {
  // Le suivi des economies d'achat (D-0xx, fiche 12) : `economie_cents` n'est
  // JAMAIS une colonne, il se recalcule a chaque lecture.
  detecterEconomiePotentielle,
  enregistrerEconomie,
  listerEconomies,
  renegocierTarifAvecEconomie,
  tableauBordEconomies,
} from './depots/economies.js';
export {
  depenseIaDuMois,
  journaliserAppelIa,
  listerAppelsIa,
  type EntreeJournalIa,
} from './depots/ia.js';
export {
  VERSION_MODELE,
  archiverPrevision,
  aujourdHui,
  coutsNewsvendor,
  creerEvenement,
  enregistrerMeteo,
  evenementsDuJour,
  facteurEvenementBp,
  lireMeteo,
  listerEvenements,
  listerPrevisions,
  // Trois fonctions de la fiche 07 (docs/demandes/07), ecrites pour nourrir
  // les nouveaux predicteurs de precision mais restees INJOIGNABLES depuis
  // `apps/api` tant qu'elles n'etaient pas reexportees ici — exactement le
  // meme defaut de « code mort, jamais appele » que la fiche elle-meme
  // denonce, une couche plus bas. Voir le rapport de livraison de l'agent
  // de cablage.
  observationsCompletesDuLieu,
  observationsDuLieu,
  // `observationsMeteoDuLieu` : meme situation que les trois fonctions
  // ci-dessus, ajoutee par l'agent des fiches 2/4 (docs/17, D-059). Sans elle,
  // `apps/api/src/routes/previsions.ts` ne peut pas classer l'historique par
  // categorie meteo pour mesurer un facteur par categorie — hors de son
  // perimetre d'ecriture d'ajouter ce baril lui-meme (voir son rapport de
  // livraison), mais l'omettre aurait fait echouer la compilation de
  // `apps/api` tout entier : meme exception que celle deja accordee ci-dessus.
  observationsMeteoDuLieu,
  pairesMeteoDuLieu,
  periodesVacancesScolaires,
  prochaineSessionPlanifiee,
  qualiteModele,
  rapprocherPrevision,
  // Prevision CALENDAIRE (fiche 06) : besoins d'ingredients projetes sur un
  // horizon, et point de commande PREDICTIF — qui anticipe ce qui va etre
  // consomme au lieu de constater ce qui l'a ete.
  ingredientsActifsAvecDelai,
  occurrencesCandidates,
  partsRecettesActives,
  serieConsommationJournaliereIngredient,
  stockProjeteIngredient,
  type IngredientReappro,
  type OccurrenceCandidate,
  type PartRecetteHistorique,
  type CoutsNewsvendor,
  type EntreeEvenement,
  type ObservationMeteoBrute,
  type SessionPlanifiee,
} from './depots/previsions.js';
export { lireProductionDetail, listerProductions } from './depots/productions.js';
export {
  lireSessionDetail,
  listerLieux,
  listerProduitsVendables,
  listerSessions,
  tableauSeuils,
  type CompteurSeuilEnrichi,
  type TableauSeuilsResultat,
} from './depots/sessions.js';
export {
  // Controle d'integrite du grand livre de stock : il existait, teste, et AUCUN
  // code de production ne l'appelait. Une regression du stock serait passee
  // inapercue jusqu'a un controle AFSCA.
  diagnostiquerIntegriteStock,
  etatDuStock,
  lotsAlerteDlc,
  lotsDeLIngredient,
  mouvementsDuLot,
  tousLesLots,
  verifierInvariantLots,
  type LigneStock,
  // `LotStock` plus la quantite initiale et le MONTANT PAYE (D-044) : c'est ce
  // couple qui rend un lot rapprochable de la facture fournisseur.
  type LotEnBase,
} from './depots/stock.js';
export {
  annulerReception,
  enregistrerReception,
  type EntreeReception,
  type LigneReception,
  type ResultatAnnulationReception,
  type ResultatReception,
} from './services/reception.js';
export {
  annulerMouvement,
  changerStatutLot,
  enregistrerSortie,
  type EntreeSortie,
  type ResultatSortie,
  type TypeSortie,
} from './services/mouvements.js';
export {
  lancerProduction,
  // Rattachement d'une production a sa session : sans lui, `production.session_id`
  // restait `NULL`, le cout de la pate n'entrait pas dans la marge de session, et
  // la tracabilite aval ne savait pas dire dans quel marche un lot etait parti.
  rattacherSession,
  // Annuler une production n'existait NULLE PART : le statut `annulee` etait
  // prevu au contrat, refuse en entree par `saisirRealise`, exclu des sommes
  // par D-038 — et rien ne l'ecrivait jamais. Une production lancee par erreur
  // restait donc definitivement engagee, stock consomme compris.
  annulerProduction,
  saisirRealise,
  sessionsDesProductions,
  verifierFaisabilite,
  type EntreeProduction,
  type RealiseProduction,
  type ResultatAnnulationProduction,
  type ResultatProduction,
  type SessionRattacheeInfo,
} from './services/production.js';
export {
  // D-083 : un releve MAL SAISI s'annule par ecriture nouvelle, les deux
  // restant visibles au registre. Le motif vit dans `journal_audit`, jamais
  // dans une colonne — meme mecanisme que `reception` et `production`.
  annulerReleveTemperature,
  cloturerNonConformite,
  declarerNonConformite,
  enregistrerExecutionNettoyage,
  enregistrerExerciceTracabilite,
  enregistrerReleveTemperature,
  executionsNettoyagePeriode,
  listerExercicesTracabilite,
  listerNonConformites,
  listerRelevesTemperature,
  listerTachesNettoyage,
  nonConformitesPeriode,
  relevesTemperaturePeriode,
  sessionsSansReleveTemperature,
  tachesEnRetard,
  type EntreeClotureNonConformite,
  type EntreeExecutionNettoyage,
  type EntreeExerciceTracabilite,
  type EntreeNonConformite,
  type EntreeReleveTemperature,
  type FrequenceNettoyage,
  type GraviteNonConformite,
  type MomentReleve,
  type ResultatAnnulationReleveTemperature,
  type ResultatExercice,
  type SessionSansReleveTemperature,
  type TacheEnRetard,
} from './services/afsca.js';
export {
  tracabiliteAmontSession,
  tracabiliteAvalLot,
  type TracabiliteAmontSession,
  type TracabiliteAvalLot,
} from './depots/tracabilite.js';
export {
  // Annuler une commande fournisseur : sans ce chemin, un brouillon errone
  // restait compte dans le « deja commande » du point de commande, et masquait
  // donc un besoin de reapprovisionnement reel.
  annulerCommande,
  // Le fait persiste « ce mail-la est-il parti ? » (mission « le seul piege
  // silencieux qui reste », 01/08/2026) : lu dans le journal d'audit, jamais
  // dans une colonne dediee. Voir `envoiModeTestConnu` dans
  // `services/commandes.ts` pour le detail.
  envoiModeTestConnu,
  genererBrouillonsCommandes,
  lireCommandeDetail,
  listerCommandes,
  marquerEnvoyee,
  validerCommande,
  type CommandeDetailLigne,
  type CommandeResumeLigne,
  type EnvoiModeTestConnu,
  type IngredientIgnoreGeneration,
  type LigneCommandeDetail,
  type ResultatGenerationCommandes,
} from './services/commandes.js';
export {
  annulerSession,
  cloturerSession,
  creerSession,
  rattacherEvenementSession,
  type EntreeCloture,
  type LigneVenteSaisie,
} from './services/sessions.js';
export {
  // Rapprochement facture fournisseur / reception (fiche 14). Trois tables
  // existaient au schema sans que rien ne les remplisse : le prix d'achat
  // restait donc fige au bon de livraison, et une remise ou une erreur de
  // facturation n'atteignait jamais le cout de revient.
  //
  // La correction de prix ne touche QUE `lot.prix_ligne_cents`, jamais un
  // mouvement de stock : un prix n'est pas une quantite (regle n°5). Et le
  // cout deja consomme reste fige — corriger un lot ne reecrit jamais la marge
  // d'une session close.
  annulerFacture,
  changerStatutFacture,
  corrigerCoutLot,
  enregistrerFacture,
  lireFactureDetail,
  listerFactures,
  receptionsEligibles,
  type EntreeFacture,
  type FactureDetail,
  type FactureResume,
  type LigneFactureDetail,
  type LigneFactureEcart,
  type LigneFactureEntree,
  type LigneReceptionEligible,
  type ResultatCorrectionLot,
  type ResultatFacture,
  type StatutFacture,
} from './services/factures.js';
export { seedAfsca, type ResultatSeedAfsca } from './seed/afsca.js';
export { seed, type ResultatSeed } from './seed/index.js';
export { seedDemonstration, type ResultatSeedDemo } from './seed/demonstration.js';
// Historique d'exploitation de demonstration (receptions, production, session
// close). Absent du baril, il forcait les tests a un import relatif
// inter-paquets — residu que ce projet traque systematiquement.
export { seedDemonstrationActivite, type ResultatSeedActivite } from './seed/activite.js';
export * from './schema.js';
