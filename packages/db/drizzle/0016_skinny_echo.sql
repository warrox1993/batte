CREATE TABLE `produit_vente_composant` (
	`id` text PRIMARY KEY NOT NULL,
	`produit_vente_id` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`quantite_unite_ref` integer NOT NULL,
	`quantite_reference_unites` integer DEFAULT 1 NOT NULL,
	`consommation_sur_place` integer,
	`actif` integer DEFAULT true NOT NULL,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL,
	FOREIGN KEY (`produit_vente_id`) REFERENCES `produit_vente`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_composant_produit` ON `produit_vente_composant` (`produit_vente_id`,`actif`);--> statement-breakpoint
CREATE INDEX `idx_composant_ingredient` ON `produit_vente_composant` (`ingredient_id`);