CREATE TABLE `amortissement_annuite` (
	`id` text PRIMARY KEY NOT NULL,
	`immobilisation_id` text NOT NULL,
	`exercice` integer NOT NULL,
	`montant_cents` integer NOT NULL,
	`valeur_nette_fin_cents` integer NOT NULL,
	FOREIGN KEY (`immobilisation_id`) REFERENCES `immobilisation`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_annuite_immo_exercice` ON `amortissement_annuite` (`immobilisation_id`,`exercice`);--> statement-breakpoint
CREATE TABLE `commande_fournisseur` (
	`id` text PRIMARY KEY NOT NULL,
	`numero` text NOT NULL,
	`fournisseur_id` text NOT NULL,
	`statut` text DEFAULT 'brouillon' NOT NULL,
	`date_creation` text NOT NULL,
	`date_envoi` text,
	`date_reception_prevue` text,
	`montant_total_cents` integer DEFAULT 0 NOT NULL,
	`genere_automatiquement` integer DEFAULT false NOT NULL,
	`email_envoye_a` text,
	`document_id` text,
	`notes` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL,
	FOREIGN KEY (`fournisseur_id`) REFERENCES `fournisseur`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_commande_numero` ON `commande_fournisseur` (`numero`);--> statement-breakpoint
CREATE INDEX `idx_commande_fournisseur` ON `commande_fournisseur` (`fournisseur_id`,`statut`);--> statement-breakpoint
CREATE INDEX `idx_commande_statut` ON `commande_fournisseur` (`statut`);--> statement-breakpoint
CREATE TABLE `commande_ligne` (
	`id` text PRIMARY KEY NOT NULL,
	`commande_id` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`conditionnement_id` text,
	`quantite_conditionnements` integer NOT NULL,
	`quantite_unite_ref` integer NOT NULL,
	`prix_unitaire_cents` real NOT NULL,
	FOREIGN KEY (`commande_id`) REFERENCES `commande_fournisseur`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conditionnement_id`) REFERENCES `conditionnement`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_commande_ligne` ON `commande_ligne` (`commande_id`);--> statement-breakpoint
CREATE TABLE `depense` (
	`id` text PRIMARY KEY NOT NULL,
	`date_depense` text NOT NULL,
	`libelle` text NOT NULL,
	`categorie` text NOT NULL,
	`montant_cents` integer NOT NULL,
	`fournisseur_id` text,
	`justificatif_path` text,
	`deductible_bp` integer DEFAULT 10000 NOT NULL,
	`immobilisation_id` text,
	`notes` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL,
	FOREIGN KEY (`fournisseur_id`) REFERENCES `fournisseur`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_depense_date` ON `depense` (`date_depense`);--> statement-breakpoint
CREATE INDEX `idx_depense_categorie` ON `depense` (`categorie`);--> statement-breakpoint
CREATE TABLE `echeance` (
	`id` text PRIMARY KEY NOT NULL,
	`libelle` text NOT NULL,
	`recurrence` text NOT NULL,
	`prochaine_date` text NOT NULL,
	`source_legale` text NOT NULL,
	`url_source` text,
	`montant_estime_cents` integer,
	`statut` text DEFAULT 'a_venir' NOT NULL,
	`date_realisation` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_echeance_date` ON `echeance` (`prochaine_date`,`statut`);--> statement-breakpoint
CREATE TABLE `exercice_tracabilite` (
	`id` text PRIMARY KEY NOT NULL,
	`date_exercice` text NOT NULL,
	`lot_depart_id` text,
	`duree_minutes` integer,
	`resultat` text NOT NULL,
	`ecarts_constates` text,
	`document_id` text,
	`cree_le` text NOT NULL,
	FOREIGN KEY (`lot_depart_id`) REFERENCES `lot`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_exercice_date` ON `exercice_tracabilite` (`date_exercice`);--> statement-breakpoint
CREATE TABLE `facture_fournisseur` (
	`id` text PRIMARY KEY NOT NULL,
	`numero_fournisseur` text NOT NULL,
	`fournisseur_id` text NOT NULL,
	`date_facture` text NOT NULL,
	`date_echeance` text,
	`montant_total_cents` integer NOT NULL,
	`fichier_scan_path` text,
	`statut` text DEFAULT 'a_rapprocher' NOT NULL,
	`notes` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL,
	FOREIGN KEY (`fournisseur_id`) REFERENCES `fournisseur`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_facture_fournisseur` ON `facture_fournisseur` (`fournisseur_id`,`date_facture`);--> statement-breakpoint
CREATE TABLE `facture_ligne` (
	`id` text PRIMARY KEY NOT NULL,
	`facture_id` text NOT NULL,
	`reception_id` text,
	`ingredient_id` text,
	`libelle` text NOT NULL,
	`quantite_unite_ref` integer,
	`montant_cents` integer NOT NULL,
	`ecart_prix_cents` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`facture_id`) REFERENCES `facture_fournisseur`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reception_id`) REFERENCES `reception`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_facture_ligne` ON `facture_ligne` (`facture_id`);--> statement-breakpoint
CREATE INDEX `idx_facture_ligne_reception` ON `facture_ligne` (`reception_id`);--> statement-breakpoint
CREATE TABLE `frais_reception` (
	`id` text PRIMARY KEY NOT NULL,
	`reception_id` text NOT NULL,
	`libelle` text NOT NULL,
	`montant_cents` integer NOT NULL,
	`methode_repartition` text DEFAULT 'valeur' NOT NULL,
	FOREIGN KEY (`reception_id`) REFERENCES `reception`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_frais_reception` ON `frais_reception` (`reception_id`);--> statement-breakpoint
CREATE TABLE `immobilisation` (
	`id` text PRIMARY KEY NOT NULL,
	`libelle` text NOT NULL,
	`date_acquisition` text NOT NULL,
	`montant_cents` integer NOT NULL,
	`duree_amortissement_annees` integer NOT NULL,
	`methode` text DEFAULT 'lineaire' NOT NULL,
	`valeur_residuelle_cents` integer DEFAULT 0 NOT NULL,
	`date_cession` text,
	`notes` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `journal_ia` (
	`id` text PRIMARY KEY NOT NULL,
	`date_appel` text NOT NULL,
	`usage` text NOT NULL,
	`modele` text NOT NULL,
	`tokens_entree` integer DEFAULT 0 NOT NULL,
	`tokens_sortie` integer DEFAULT 0 NOT NULL,
	`cout_cents` integer DEFAULT 0 NOT NULL,
	`prompt_hash` text,
	`reponse_brute` text,
	`validee_par_humain` integer,
	`duree_ms` integer,
	`erreur` text
);
--> statement-breakpoint
CREATE INDEX `idx_ia_date` ON `journal_ia` (`date_appel`);--> statement-breakpoint
CREATE INDEX `idx_ia_usage` ON `journal_ia` (`usage`);--> statement-breakpoint
CREATE TABLE `nettoyage_execution` (
	`id` text PRIMARY KEY NOT NULL,
	`tache_id` text NOT NULL,
	`session_id` text,
	`date_execution` text NOT NULL,
	`execute_par` text,
	`observations` text,
	`cree_le` text NOT NULL,
	FOREIGN KEY (`tache_id`) REFERENCES `tache_nettoyage`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `session_marche`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_nettoyage_tache` ON `nettoyage_execution` (`tache_id`,`date_execution`);--> statement-breakpoint
CREATE INDEX `idx_nettoyage_date` ON `nettoyage_execution` (`date_execution`);--> statement-breakpoint
CREATE TABLE `non_conformite` (
	`id` text PRIMARY KEY NOT NULL,
	`date_constat` text NOT NULL,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`gravite` text NOT NULL,
	`action_corrective` text,
	`date_resolution` text,
	`session_id` text,
	`lot_id` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session_marche`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `lot`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_nc_date` ON `non_conformite` (`date_constat`);--> statement-breakpoint
CREATE INDEX `idx_nc_gravite` ON `non_conformite` (`gravite`);--> statement-breakpoint
CREATE TABLE `periode` (
	`id` text PRIMARY KEY NOT NULL,
	`annee` integer NOT NULL,
	`mois` integer NOT NULL,
	`statut` text DEFAULT 'ouverte' NOT NULL,
	`date_cloture` text,
	`cloturee_par` text,
	`date_reouverture` text,
	`motif_reouverture` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_periode_annee_mois` ON `periode` (`annee`,`mois`);--> statement-breakpoint
CREATE TABLE `releve_temperature` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`production_id` text,
	`equipement` text NOT NULL,
	`temperature_c` real NOT NULL,
	`date_releve` text NOT NULL,
	`moment` text NOT NULL,
	`conforme` integer NOT NULL,
	`action_corrective` text,
	`releve_par` text,
	`cree_le` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session_marche`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`production_id`) REFERENCES `production`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_temperature_session` ON `releve_temperature` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_temperature_date` ON `releve_temperature` (`date_releve`);--> statement-breakpoint
CREATE INDEX `idx_temperature_conforme` ON `releve_temperature` (`conforme`);--> statement-breakpoint
CREATE TABLE `tache_nettoyage` (
	`id` text PRIMARY KEY NOT NULL,
	`libelle` text NOT NULL,
	`frequence` text NOT NULL,
	`zone` text NOT NULL,
	`actif` integer DEFAULT true NOT NULL,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL
);
