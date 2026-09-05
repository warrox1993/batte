-- Regle d'architecture n°3 : « argent en entiers ». Les colonnes
-- `prix_unitaire_cents` de `lot` et `commande_ligne` etaient en `real` parce
-- qu'elles portaient un TAUX (0,075 centime par gramme) et non un montant. Le
-- defaut n'etait pas le type, il etait en amont : on stockait le QUOTIENT
-- `prix_ligne / quantite` et on jetait le montant paye, pourtant deja entier.
-- Un lot n'etait alors plus rapprochable au centime pres de la facture
-- fournisseur, ce qui rend impossible le rapprochement a trois prevu par
-- `facture_fournisseur`. On stocke desormais le montant, on derive le taux.
--
-- MIGRATION ECRITE A LA MAIN. La recette habituelle de SQLite (table `__new_`,
-- `INSERT ... SELECT`, `DROP TABLE`, `RENAME`) est INAPPLICABLE ici : le
-- migrateur Drizzle enveloppe toutes les migrations dans un `BEGIN ... COMMIT`,
-- or `PRAGMA foreign_keys=OFF` est sans effet a l'interieur d'une transaction.
-- Le `DROP TABLE lot` declenche alors le `DELETE FROM lot` implicite qui viole
-- les cles etrangeres de `mouvement_stock` et `production_consommation`, et la
-- migration entiere echoue (verifie sur SQLite 3.53 : « FOREIGN KEY constraint
-- failed », y compris avec `defer_foreign_keys`). On procede donc par
-- ajout / conversion / suppression, qui ne touche a aucune cle etrangere.
--
-- Regle n°7, « rien ne s'efface » : l'`UPDATE` de conversion s'execute AVANT le
-- `DROP COLUMN`. Il reconstitue le montant reellement paye a partir du taux et
-- de la quantite. `ROUND` puis `CAST ... AS INTEGER` plutot qu'un `CAST` seul :
-- `CAST` tronque vers zero et perdrait jusqu'a un centime par ligne.
--
-- Le `DEFAULT 0` porte par les deux colonnes est un residu technique assume :
-- SQLite exige une valeur par defaut non nulle pour ajouter une colonne
-- `NOT NULL` a une table qui contient deja des lignes, et ne sait pas la
-- retirer ensuite sans recreer la table — ce que les cles etrangeres
-- interdisent precisement ici. Aucun code applicatif ne s'en sert : le schema
-- Drizzle declare la colonne `notNull()` sans defaut, donc toute insertion doit
-- fournir le montant.

ALTER TABLE `lot` ADD `prix_ligne_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `lot` SET `prix_ligne_cents` = CAST(ROUND(`prix_unitaire_cents` * `quantite_initiale`) AS INTEGER);--> statement-breakpoint
ALTER TABLE `lot` DROP COLUMN `prix_unitaire_cents`;--> statement-breakpoint
ALTER TABLE `commande_ligne` ADD `prix_ligne_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `commande_ligne` SET `prix_ligne_cents` = CAST(ROUND(`prix_unitaire_cents` * `quantite_unite_ref`) AS INTEGER);--> statement-breakpoint
ALTER TABLE `commande_ligne` DROP COLUMN `prix_unitaire_cents`;
