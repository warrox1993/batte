ALTER TABLE `session_marche` ADD `cout_deplacement_reel_session_cents` integer;--> statement-breakpoint
ALTER TABLE `session_marche` ADD `cout_deplacement_reel_detour_achats_cents` integer;--> statement-breakpoint
ALTER TABLE `session_marche` ADD `cout_deplacement_reel_total_cents` integer;--> statement-breakpoint
CREATE INDEX `idx_session_evenement` ON `session_marche` (`evenement_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_enregistrement` ON `journal_audit` (`enregistrement_id`);--> statement-breakpoint
CREATE INDEX `idx_nc_lot` ON `non_conformite` (`lot_id`);