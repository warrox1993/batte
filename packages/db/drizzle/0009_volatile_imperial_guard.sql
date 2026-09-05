CREATE TABLE `economie_achat` (
	`id` text PRIMARY KEY NOT NULL,
	`date_action` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`fournisseur_id` text NOT NULL,
	`conditionnement_id` text,
	`type_action` text NOT NULL,
	`description` text NOT NULL,
	`prix_unitaire_avant_cents` integer NOT NULL,
	`prix_unitaire_apres_cents` integer NOT NULL,
	`quantite_concernee` integer NOT NULL,
	`commande_id` text,
	`saisi_par` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fournisseur_id`) REFERENCES `fournisseur`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conditionnement_id`) REFERENCES `conditionnement`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`commande_id`) REFERENCES `commande_fournisseur`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_economie_date` ON `economie_achat` (`date_action`);--> statement-breakpoint
CREATE INDEX `idx_economie_ingredient` ON `economie_achat` (`ingredient_id`);--> statement-breakpoint
CREATE INDEX `idx_economie_fournisseur` ON `economie_achat` (`fournisseur_id`);--> statement-breakpoint
CREATE INDEX `idx_economie_type_date` ON `economie_achat` (`type_action`,`date_action`);