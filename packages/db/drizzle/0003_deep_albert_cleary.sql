CREATE TABLE `production` (
	`id` text PRIMARY KEY NOT NULL,
	`numero` text NOT NULL,
	`recette_id` text NOT NULL,
	`date_production` text NOT NULL,
	`statut` text DEFAULT 'lancee' NOT NULL,
	`volume_theorique_ml` integer NOT NULL,
	`crepes_theoriques` integer NOT NULL,
	`cout_matiere_theorique_cents` integer NOT NULL,
	`volume_reel_ml` integer,
	`crepes_reelles` integer,
	`cout_matiere_reel_cents` integer,
	`numero_lot_pate` text NOT NULL,
	`date_dlc_pate` text NOT NULL,
	`session_id` text,
	`ordre_prevision_id` text,
	`ecart_motif` text,
	`notes` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL,
	FOREIGN KEY (`recette_id`) REFERENCES `recette`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_production_numero` ON `production` (`numero`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_production_lot_pate` ON `production` (`numero_lot_pate`);--> statement-breakpoint
CREATE INDEX `idx_production_date` ON `production` (`date_production`);--> statement-breakpoint
CREATE INDEX `idx_production_recette` ON `production` (`recette_id`);--> statement-breakpoint
CREATE INDEX `idx_production_session` ON `production` (`session_id`);--> statement-breakpoint
CREATE TABLE `production_consommation` (
	`id` text PRIMARY KEY NOT NULL,
	`production_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`quantite_theorique` integer NOT NULL,
	`quantite_reelle` integer,
	`cout_cents` integer NOT NULL,
	FOREIGN KEY (`production_id`) REFERENCES `production`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `lot`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_consommation_production` ON `production_consommation` (`production_id`);--> statement-breakpoint
CREATE INDEX `idx_consommation_lot` ON `production_consommation` (`lot_id`);--> statement-breakpoint
CREATE INDEX `idx_consommation_ingredient` ON `production_consommation` (`ingredient_id`);