CREATE TABLE `evenement` (
	`id` text PRIMARY KEY NOT NULL,
	`nom` text NOT NULL,
	`type` text NOT NULL,
	`date_debut` text NOT NULL,
	`date_fin` text NOT NULL,
	`portee` text NOT NULL,
	`intensite_estimee` integer DEFAULT 3 NOT NULL,
	`impact_estime_bp` integer DEFAULT 10000 NOT NULL,
	`impact_mesure_bp` integer,
	`source` text,
	`valide_par_humain` integer DEFAULT false NOT NULL,
	`notes` text,
	`cree_le` text NOT NULL,
	`modifie_le` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_evenement_dates` ON `evenement` (`date_debut`,`date_fin`);--> statement-breakpoint
CREATE TABLE `meteo_observation` (
	`id` text PRIMARY KEY NOT NULL,
	`lieu_id` text NOT NULL,
	`date_observation` text NOT NULL,
	`type` text NOT NULL,
	`temperature_c` real,
	`temperature_ressentie_c` real,
	`precipitations_mm` real,
	`probabilite_pluie_bp` integer,
	`vent_kmh` real,
	`couverture_nuageuse_bp` integer,
	`code_meteo` integer,
	`donnees_brutes` text,
	`recupere_le` text NOT NULL,
	FOREIGN KEY (`lieu_id`) REFERENCES `lieu_marche`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_meteo_lieu_date_type` ON `meteo_observation` (`lieu_id`,`date_observation`,`type`);--> statement-breakpoint
CREATE TABLE `prevision` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`date_calcul` text NOT NULL,
	`version_modele` text NOT NULL,
	`baseline_crepes` integer NOT NULL,
	`facteur_meteo_bp` integer NOT NULL,
	`facteur_evenement_bp` integer NOT NULL,
	`facteur_saison_bp` integer NOT NULL,
	`facteur_tendance_bp` integer NOT NULL,
	`p10_crepes` integer NOT NULL,
	`p50_crepes` integer NOT NULL,
	`p90_crepes` integer NOT NULL,
	`quantile_cible_bp` integer NOT NULL,
	`crepes_recommandees` integer NOT NULL,
	`crepes_retenues` integer NOT NULL,
	`contrainte_limitante` text,
	`manque_a_gagner_cents` integer,
	`repartition_recettes` text,
	`confiance_bp` integer NOT NULL,
	`nb_sessions_comparables` integer NOT NULL,
	`commentaire_ia` text,
	`explication_facteurs` text,
	`crepes_reelles` integer,
	`erreur_absolue_bp` integer,
	FOREIGN KEY (`session_id`) REFERENCES `session_marche`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_prevision_session` ON `prevision` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_prevision_date` ON `prevision` (`date_calcul`);