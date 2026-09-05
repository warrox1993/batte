CREATE TABLE `concurrent` (
	`id` text PRIMARY KEY NOT NULL,
	`nom` text NOT NULL,
	`lieu_id` text NOT NULL,
	`type_offre` text NOT NULL,
	`positionnement` text NOT NULL,
	`emplacement_observe` text,
	`qualite_percue` integer NOT NULL,
	`date_derniere_observation` text,
	`notes_generales` text,
	`actif` integer DEFAULT true NOT NULL,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL,
	FOREIGN KEY (`lieu_id`) REFERENCES `lieu_marche`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_concurrent_lieu` ON `concurrent` (`lieu_id`);--> statement-breakpoint
CREATE INDEX `idx_concurrent_actif` ON `concurrent` (`actif`);--> statement-breakpoint
CREATE TABLE `concurrent_observation` (
	`id` text PRIMARY KEY NOT NULL,
	`concurrent_id` text NOT NULL,
	`date_observation` text NOT NULL,
	`affluence_estimee` text NOT NULL,
	`file_attente` integer DEFAULT false NOT NULL,
	`notes` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL,
	FOREIGN KEY (`concurrent_id`) REFERENCES `concurrent`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_concurrent_observation_concurrent` ON `concurrent_observation` (`concurrent_id`);--> statement-breakpoint
CREATE INDEX `idx_concurrent_observation_date` ON `concurrent_observation` (`date_observation`);--> statement-breakpoint
CREATE TABLE `concurrent_produit` (
	`id` text PRIMARY KEY NOT NULL,
	`concurrent_id` text NOT NULL,
	`nom_produit` text NOT NULL,
	`prix_cents` integer NOT NULL,
	`description` text,
	`date_observation` text NOT NULL,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL,
	FOREIGN KEY (`concurrent_id`) REFERENCES `concurrent`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_concurrent_produit_concurrent` ON `concurrent_produit` (`concurrent_id`);--> statement-breakpoint
CREATE INDEX `idx_concurrent_produit_historique` ON `concurrent_produit` (`concurrent_id`,`nom_produit`,`date_observation`);