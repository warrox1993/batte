CREATE TABLE `catalogue_produit` (
	`id` text PRIMARY KEY NOT NULL,
	`fournisseur_id` text NOT NULL,
	`ingredient_id` text,
	`reference_fournisseur` text,
	`designation` text NOT NULL,
	`conditionnement_texte` text,
	`quantite_unite_ref` integer,
	`unite_reference` text,
	`prix_cents` integer,
	`taux_tva_bps` integer,
	`date_prix` text NOT NULL,
	`source` text NOT NULL,
	`actif` integer DEFAULT true NOT NULL,
	`notes` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL,
	FOREIGN KEY (`fournisseur_id`) REFERENCES `fournisseur`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_catalogue_fournisseur` ON `catalogue_produit` (`fournisseur_id`,`actif`);--> statement-breakpoint
CREATE INDEX `idx_catalogue_ingredient` ON `catalogue_produit` (`ingredient_id`);--> statement-breakpoint
CREATE INDEX `idx_catalogue_reference` ON `catalogue_produit` (`fournisseur_id`,`reference_fournisseur`);