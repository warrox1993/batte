CREATE TABLE `conditionnement` (
	`id` text PRIMARY KEY NOT NULL,
	`ingredient_id` text NOT NULL,
	`fournisseur_id` text NOT NULL,
	`libelle` text NOT NULL,
	`quantite_unite_ref` integer NOT NULL,
	`prix_cents` integer NOT NULL,
	`reference_fournisseur` text,
	`date_prix` text NOT NULL,
	`actif` integer DEFAULT true NOT NULL,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fournisseur_id`) REFERENCES `fournisseur`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_conditionnement_ingredient` ON `conditionnement` (`ingredient_id`,`actif`);--> statement-breakpoint
CREATE INDEX `idx_conditionnement_fournisseur` ON `conditionnement` (`fournisseur_id`);--> statement-breakpoint
CREATE INDEX `idx_conditionnement_prix` ON `conditionnement` (`ingredient_id`,`date_prix`);--> statement-breakpoint
CREATE TABLE `fournisseur` (
	`id` text PRIMARY KEY NOT NULL,
	`nom` text NOT NULL,
	`type` text NOT NULL,
	`email` text,
	`telephone` text,
	`adresse` text,
	`delai_livraison_jours` integer DEFAULT 0 NOT NULL,
	`franco_de_port_cents` integer,
	`commande_minimum_cents` integer,
	`actif` integer DEFAULT true NOT NULL,
	`notes` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_fournisseur_actif` ON `fournisseur` (`actif`);--> statement-breakpoint
CREATE TABLE `ingredient` (
	`id` text PRIMARY KEY NOT NULL,
	`nom` text NOT NULL,
	`categorie` text NOT NULL,
	`unite_reference` text NOT NULL,
	`densite_g_par_ml` real,
	`allergenes` text DEFAULT '[]' NOT NULL,
	`stock_securite` integer DEFAULT 0 NOT NULL,
	`delai_livraison_jours` integer,
	`duree_conservation_jours` integer,
	`actif` integer DEFAULT true NOT NULL,
	`notes` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ingredient_nom` ON `ingredient` (`nom`);--> statement-breakpoint
CREATE INDEX `idx_ingredient_actif` ON `ingredient` (`actif`);--> statement-breakpoint
CREATE TABLE `produit_garniture` (
	`id` text PRIMARY KEY NOT NULL,
	`produit_vente_id` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`quantite_unite_ref` integer NOT NULL,
	FOREIGN KEY (`produit_vente_id`) REFERENCES `produit_vente`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_garniture_unique` ON `produit_garniture` (`produit_vente_id`,`ingredient_id`);--> statement-breakpoint
CREATE TABLE `produit_vente` (
	`id` text PRIMARY KEY NOT NULL,
	`nom` text NOT NULL,
	`nature` text NOT NULL,
	`recette_id` text,
	`ingredient_id` text,
	`prix_cents` integer NOT NULL,
	`nb_crepes` integer DEFAULT 1,
	`categorie` text,
	`consommation_sur_place` integer DEFAULT false NOT NULL,
	`actif` integer DEFAULT true NOT NULL,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL,
	FOREIGN KEY (`recette_id`) REFERENCES `recette`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_produit_nature` ON `produit_vente` (`nature`,`actif`);--> statement-breakpoint
CREATE INDEX `idx_produit_recette` ON `produit_vente` (`recette_id`);--> statement-breakpoint
CREATE TABLE `recette` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`nom` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`recette_parent_id` text,
	`statut` text DEFAULT 'brouillon' NOT NULL,
	`type_pate` text NOT NULL,
	`sans_gluten` integer DEFAULT false NOT NULL,
	`rendement_reference_ml` integer NOT NULL,
	`rendement_reference_crepes` integer NOT NULL,
	`perte_cuisson_bp` integer DEFAULT 0 NOT NULL,
	`taux_casse_bp` integer DEFAULT 0 NOT NULL,
	`perte_fixe_ml` integer DEFAULT 0 NOT NULL,
	`procede` text,
	`date_activation` text,
	`notes` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_recette_code_version` ON `recette` (`code`,`version`);--> statement-breakpoint
CREATE INDEX `idx_recette_statut` ON `recette` (`statut`);--> statement-breakpoint
CREATE TABLE `recette_ligne` (
	`id` text PRIMARY KEY NOT NULL,
	`recette_id` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`quantite_unite_ref` integer NOT NULL,
	`ordre` integer DEFAULT 0 NOT NULL,
	`note_technique` text,
	FOREIGN KEY (`recette_id`) REFERENCES `recette`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_recette_ligne_unique` ON `recette_ligne` (`recette_id`,`ingredient_id`);--> statement-breakpoint
CREATE INDEX `idx_recette_ligne_recette` ON `recette_ligne` (`recette_id`,`ordre`);