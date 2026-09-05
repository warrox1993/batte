CREATE TABLE `lieu_marche` (
	`id` text PRIMARY KEY NOT NULL,
	`nom` text NOT NULL,
	`adresse` text,
	`latitude` real,
	`longitude` real,
	`jour_semaine` integer,
	`heure_debut` text,
	`heure_fin` text,
	`tarif_emplacement_cents` integer,
	`mode_tarification` text,
	`metres_lineaires` integer,
	`actif` integer DEFAULT true NOT NULL,
	`notes` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_frais` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`libelle` text NOT NULL,
	`categorie` text NOT NULL,
	`montant_cents` integer NOT NULL,
	`justificatif_path` text,
	FOREIGN KEY (`session_id`) REFERENCES `session_marche`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_frais_session` ON `session_frais` (`session_id`);--> statement-breakpoint
CREATE TABLE `session_marche` (
	`id` text PRIMARY KEY NOT NULL,
	`numero` text NOT NULL,
	`lieu_id` text NOT NULL,
	`date_session` text NOT NULL,
	`heure_debut_reelle` text,
	`heure_fin_reelle` text,
	`statut` text DEFAULT 'planifiee' NOT NULL,
	`exclure_du_modele` integer DEFAULT false NOT NULL,
	`motif_exclusion` text,
	`meteo_prevue` text,
	`meteo_reelle` text,
	`fonds_caisse_initial_cents` integer DEFAULT 0 NOT NULL,
	`especes_comptees_cents` integer,
	`ca_carte_cents` integer,
	`ca_especes_cents` integer,
	`ecart_caisse_cents` integer,
	`ca_total_cents` integer,
	`ca_transforme_cents` integer,
	`ca_revendu_cents` integer,
	`ca_sur_place_cents` integer,
	`nb_transactions` integer,
	`cout_matiere_cents` integer,
	`commission_carte_cents` integer,
	`frais_emplacement_cents` integer DEFAULT 0 NOT NULL,
	`frais_deplacement_cents` integer DEFAULT 0 NOT NULL,
	`frais_gaz_cents` integer DEFAULT 0 NOT NULL,
	`frais_divers_cents` integer DEFAULT 0 NOT NULL,
	`crepes_produites` integer DEFAULT 0 NOT NULL,
	`crepes_vendues` integer DEFAULT 0 NOT NULL,
	`crepes_invendues` integer DEFAULT 0 NOT NULL,
	`crepes_cassees` integer DEFAULT 0 NOT NULL,
	`marge_brute_cents` integer,
	`marge_nette_cents` integer,
	`notes_qualitatives` text,
	`date_cloture` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL,
	FOREIGN KEY (`lieu_id`) REFERENCES `lieu_marche`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_session_numero` ON `session_marche` (`numero`);--> statement-breakpoint
CREATE INDEX `idx_session_date` ON `session_marche` (`date_session`);--> statement-breakpoint
CREATE INDEX `idx_session_statut` ON `session_marche` (`statut`);--> statement-breakpoint
CREATE INDEX `idx_session_lieu` ON `session_marche` (`lieu_id`);--> statement-breakpoint
CREATE TABLE `session_vente` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`produit_vente_id` text NOT NULL,
	`quantite` integer NOT NULL,
	`prix_unitaire_cents` integer NOT NULL,
	`montant_cents` integer NOT NULL,
	`creneau_horaire` text,
	FOREIGN KEY (`session_id`) REFERENCES `session_marche`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`produit_vente_id`) REFERENCES `produit_vente`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_vente_session` ON `session_vente` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_vente_produit` ON `session_vente` (`produit_vente_id`);