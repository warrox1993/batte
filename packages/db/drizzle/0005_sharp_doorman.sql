CREATE TABLE `document_genere` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`objet_id` text,
	`numero` text,
	`version` integer DEFAULT 1 NOT NULL,
	`date_generation` text NOT NULL,
	`chemin` text NOT NULL,
	`taille_octets` integer NOT NULL,
	`hash_sha256` text NOT NULL,
	`parametres_source` text,
	`cree_par` text
);
--> statement-breakpoint
CREATE INDEX `idx_document_type_objet` ON `document_genere` (`type`,`objet_id`);--> statement-breakpoint
CREATE INDEX `idx_document_date` ON `document_genere` (`date_generation`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_document_type_objet_version` ON `document_genere` (`type`,`objet_id`,`version`);