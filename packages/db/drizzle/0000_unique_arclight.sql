CREATE TABLE `journal_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`table_cible` text NOT NULL,
	`enregistrement_id` text NOT NULL,
	`action` text NOT NULL,
	`valeurs_avant` text,
	`valeurs_apres` text,
	`date_action` text NOT NULL,
	`utilisateur` text
);
--> statement-breakpoint
CREATE INDEX `idx_audit_cible` ON `journal_audit` (`table_cible`,`enregistrement_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_date` ON `journal_audit` (`date_action`);--> statement-breakpoint
CREATE TABLE `parametre` (
	`id` text PRIMARY KEY NOT NULL,
	`cle` text NOT NULL,
	`valeur` text NOT NULL,
	`type_valeur` text NOT NULL,
	`date_debut_validite` text NOT NULL,
	`date_fin_validite` text,
	`source` text NOT NULL,
	`description` text NOT NULL,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_parametre_cle_debut` ON `parametre` (`cle`,`date_debut_validite`);--> statement-breakpoint
CREATE INDEX `idx_parametre_cle` ON `parametre` (`cle`);--> statement-breakpoint
CREATE TABLE `utilisateur` (
	`id` text PRIMARY KEY NOT NULL,
	`nom` text NOT NULL,
	`role` text NOT NULL,
	`actif` integer DEFAULT true NOT NULL,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL
);
