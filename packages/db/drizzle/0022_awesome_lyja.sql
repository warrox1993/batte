CREATE TABLE `objectif` (
	`id` text PRIMARY KEY NOT NULL,
	`grandeur` text NOT NULL,
	`date_debut` text NOT NULL,
	`date_fin` text NOT NULL,
	`valeur_cible` integer NOT NULL,
	`notes` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL
);
