DROP INDEX `idx_meteo_lieu_date_type`;--> statement-breakpoint
ALTER TABLE `meteo_observation` ADD `horizon_jours` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_meteo_lieu_date_type_horizon` ON `meteo_observation` (`lieu_id`,`date_observation`,`type`,`horizon_jours`);