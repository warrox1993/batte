ALTER TABLE `evenement` ADD `lieu_id` text REFERENCES lieu_marche(id);--> statement-breakpoint
ALTER TABLE `evenement` ADD `distance_km` integer;--> statement-breakpoint
ALTER TABLE `evenement` ADD `commune_texte` text;--> statement-breakpoint
ALTER TABLE `evenement` ADD `rejete_le` text;