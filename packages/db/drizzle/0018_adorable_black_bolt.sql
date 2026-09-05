CREATE TABLE `equipement` (
	`id` text PRIMARY KEY NOT NULL,
	`nom` text NOT NULL,
	`type` text NOT NULL,
	`puissance_w` integer NOT NULL,
	`en_service` integer DEFAULT false NOT NULL,
	`notes` text,
	`actif` integer DEFAULT true NOT NULL,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_equipement_service` ON `equipement` (`en_service`,`actif`);--> statement-breakpoint
CREATE TABLE `equipement_session` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`equipement_id` text NOT NULL,
	`duree_minutes` integer NOT NULL,
	`cree_le` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session_marche`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`equipement_id`) REFERENCES `equipement`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_equipement_session` ON `equipement_session` (`session_id`,`equipement_id`);--> statement-breakpoint
CREATE INDEX `idx_equipement_session_equipement` ON `equipement_session` (`equipement_id`);--> statement-breakpoint
ALTER TABLE `evenement` ADD `famille` text;--> statement-breakpoint
ALTER TABLE `evenement` ADD `effectif_estime` integer;