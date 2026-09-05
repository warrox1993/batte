ALTER TABLE `ingredient` ADD `allergenes_verifies` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Reprise des donnees existantes.
--
-- Le defaut est `false` — « jamais evalue » — parce que c'est la seule chose
-- qu'on sache honnetement d'une liste d'allergenes vide : elle peut aussi bien
-- vouloir dire « controle, il n'y en a pas » que « on ne s'est jamais pose la
-- question ». En matiere d'allergene, le doute se dit, il ne s'arrondit pas.
--
-- Une liste NON vide, elle, est une preuve : quelqu'un a saisi ces allergenes,
-- donc l'ingredient a bien ete evalue. Ces lignes passent donc a `true`. Sans
-- cette reprise, le porteur verrait « non verifie » sur des ingredients qu'il a
-- pourtant renseignes, et l'avertissement perdrait tout son sens a force
-- d'apparaitre partout.
UPDATE `ingredient` SET `allergenes_verifies` = 1 WHERE json_array_length(`allergenes`) > 0;