CREATE TABLE `lot` (
	`id` text PRIMARY KEY NOT NULL,
	`ingredient_id` text NOT NULL,
	`fournisseur_id` text NOT NULL,
	`reception_id` text NOT NULL,
	`numero_lot_fournisseur` text,
	`date_reception` text NOT NULL,
	`date_dlc` text,
	`quantite_initiale` integer NOT NULL,
	`prix_unitaire_cents` real NOT NULL,
	`statut` text DEFAULT 'disponible' NOT NULL,
	`motif_statut_id` text,
	`date_changement_statut` text,
	`notes` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fournisseur_id`) REFERENCES `fournisseur`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reception_id`) REFERENCES `reception`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`motif_statut_id`) REFERENCES `motif`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_lot_fefo` ON `lot` (`ingredient_id`,`statut`,`date_dlc`);--> statement-breakpoint
CREATE INDEX `idx_lot_reception` ON `lot` (`reception_id`);--> statement-breakpoint
CREATE INDEX `idx_lot_dlc` ON `lot` (`date_dlc`);--> statement-breakpoint
CREATE TABLE `motif` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`libelle` text NOT NULL,
	`categorie` text NOT NULL,
	`actif` integer DEFAULT true NOT NULL,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_motif_code` ON `motif` (`code`);--> statement-breakpoint
CREATE TABLE `mouvement_stock` (
	`id` text PRIMARY KEY NOT NULL,
	`lot_id` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`type` text NOT NULL,
	`quantite` integer NOT NULL,
	`date_mouvement` text NOT NULL,
	`valuation_date` text NOT NULL,
	`ajustement` integer DEFAULT false NOT NULL,
	`production_id` text,
	`session_id` text,
	`motif_id` text,
	`motif_texte` text,
	`cout_cents` integer DEFAULT 0 NOT NULL,
	`is_annule` integer DEFAULT false NOT NULL,
	`annule_par_id` text,
	`cree_par` text,
	`cree_le` text NOT NULL,
	FOREIGN KEY (`lot_id`) REFERENCES `lot`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`motif_id`) REFERENCES `motif`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_mouvement_lot` ON `mouvement_stock` (`lot_id`,`is_annule`);--> statement-breakpoint
CREATE INDEX `idx_mouvement_ingredient` ON `mouvement_stock` (`ingredient_id`,`date_mouvement`);--> statement-breakpoint
CREATE INDEX `idx_mouvement_production` ON `mouvement_stock` (`production_id`);--> statement-breakpoint
CREATE INDEX `idx_mouvement_session` ON `mouvement_stock` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_mouvement_date` ON `mouvement_stock` (`date_mouvement`);--> statement-breakpoint
CREATE TABLE `reception` (
	`id` text PRIMARY KEY NOT NULL,
	`numero` text NOT NULL,
	`fournisseur_id` text NOT NULL,
	`date_reception` text NOT NULL,
	`numero_bon_livraison` text,
	`montant_total_cents` integer,
	`fichier_scan_path` text,
	`commande_id` text,
	`source` text DEFAULT 'manuelle' NOT NULL,
	`notes` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL,
	FOREIGN KEY (`fournisseur_id`) REFERENCES `fournisseur`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reception_numero` ON `reception` (`numero`);--> statement-breakpoint
CREATE INDEX `idx_reception_date` ON `reception` (`date_reception`);--> statement-breakpoint
CREATE INDEX `idx_reception_fournisseur` ON `reception` (`fournisseur_id`);--> statement-breakpoint
CREATE TABLE `serie_numero` (
	`id` text PRIMARY KEY NOT NULL,
	`nature` text NOT NULL,
	`prefixe` text NOT NULL,
	`annee` integer NOT NULL,
	`dernier_numero` integer DEFAULT 0 NOT NULL,
	`autorise_trous` integer DEFAULT false NOT NULL,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_serie_nature_annee` ON `serie_numero` (`nature`,`annee`);