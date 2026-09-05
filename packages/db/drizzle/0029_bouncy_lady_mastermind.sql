ALTER TABLE `produit_vente` ADD `consommation_unite` text;--> statement-breakpoint
-- Reprise de l'existant, SANS rien deviner : jusqu'a aujourd'hui `nb_crepes`
-- portait a lui seul les deux sens, donc ce que chaque ligne voulait dire est
-- connu avec certitude et se relit mecaniquement.
--
-- `nb_crepes >= 1` : l'unite consomme des crepes.
--
-- `nb_crepes = 0` : jusqu'a cette migration, c'etait l'UNIQUE facon d'exprimer
-- « pate vendue telle quelle ». Le troisieme cas (`nomenclature`) n'existait
-- pas, donc aucune ligne existante ne peut vouloir dire autre chose.
--
-- `revendu` et `menu` restent NULL : la question ne se pose pas pour eux. Un
-- `transforme` a `nb_crepes` NULL reste NULL aussi — c'est une saisie
-- incomplete que la validation refuse deja ; on ne lui invente pas un sens ici.
--
-- PIEGE DE FORME, paye une fois : ne JAMAIS citer le marqueur de decoupe de
-- Drizzle dans un commentaire de ce fichier. Il est cherche litteralement, donc
-- un commentaire qui le nomme decoupe reellement le fichier, et le morceau qui
-- suit ne contient que du texte — « SQL string contains no statements ».
UPDATE `produit_vente` SET `consommation_unite` = 'crepes'
  WHERE `nature` = 'transforme' AND `nb_crepes` >= 1;
--> statement-breakpoint
UPDATE `produit_vente` SET `consommation_unite` = 'volume_pate'
  WHERE `nature` = 'transforme' AND `nb_crepes` = 0;
