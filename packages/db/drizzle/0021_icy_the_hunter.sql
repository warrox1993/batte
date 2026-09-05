CREATE TABLE `menu_composition` (
	`id` text PRIMARY KEY NOT NULL,
	`menu_id` text NOT NULL,
	`produit_inclus_id` text NOT NULL,
	`quantite` integer DEFAULT 1 NOT NULL,
	`actif` integer DEFAULT true NOT NULL,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL,
	FOREIGN KEY (`menu_id`) REFERENCES `produit_vente`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`produit_inclus_id`) REFERENCES `produit_vente`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_menu_composition` ON `menu_composition` (`menu_id`,`produit_inclus_id`);--> statement-breakpoint
CREATE INDEX `idx_menu_composition_inclus` ON `menu_composition` (`produit_inclus_id`);--> statement-breakpoint
ALTER TABLE `produit_vente_composant` ADD `optionnel` integer DEFAULT false NOT NULL;