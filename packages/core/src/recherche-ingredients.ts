/**
 * Recherche d'ingredient par nom ET synonymes courants (fiche 09 — écran
 * Ingrédients : « champ de recherche qui matche sur le nom ET les synonymes
 * courants, pour éviter les doublons de saisie »).
 *
 * POURQUOI CE FICHIER EXISTE, ET POURQUOI CE N'EST PAS UNE COLONNE. La fiche
 * demande explicitement de trancher entre une colonne sur `ingredient`, une
 * table dediee, ou une simple normalisation de recherche. Une colonne ou une
 * table est ECARTEE ici, pour deux raisons :
 *
 *  1. Le schema est hors zone pour cet agent (frontiere de la vague de travail
 *     en cours) — mais surtout, une colonne saisissable ferait de « quels sont
 *     les synonymes d'un ingredient ? » une decision utilisateur ad hoc, prise
 *     un ingredient a la fois, un jour de saisie pressee. Or « vergeoise » et
 *     « cassonade » ne sont pas propres A UN ingredient : c'est une relation
 *     entre plusieurs noms d'usage pour la MEME famille de denree. La modeliser
 *     par ingredient obligerait a la ressaisir sur chaque synonyme (vergeoise
 *     doit dire « cassonade », ET cassonade doit dire « vergeoise »), ce que
 *     personne ne fait deux fois de suite : c'est exactement le defaut que
 *     `stockSecurite` a 0 partout (docs/13 §4.7) a deja illustre sur ce projet.
 *  2. Le vrai gisement de doublons n'est PAS l'absence de synonymes eux-memes,
 *     c'est la variation de saisie ordinaire : accents, casse, pluriel, « œ »
 *     tape « oe ». Une normalisation resout deja la moitie des cas sans aucune
 *     donnee supplementaire a maintenir.
 *
 * CE QUI RESTE UN CATALOGUE FERME EN TYPESCRIPT, ET POURQUOI CE N'EST PAS UNE
 * CONTOURNEMENT DU SCHEMA. Une normalisation seule (accents/casse/pluriel) ne
 * rapproche JAMAIS « vergeoise » de « cassonade » : ce sont deux mots
 * differents, pas deux graphies du meme mot. Repondre a l'exemple de la fiche
 * exige donc une liste de groupes de noms interchangeables. Ce projet a deja
 * ce patron pour des listes REGLEMENTAIRES ou metier fermees, jamais
 * modifiables depuis un ecran : `CATALOGUE_ALLERGENES` (contrats/referentiel.ts)
 * et `CATALOGUE_MOTIFS` (motifs.ts). `CATALOGUE_SYNONYMES_INGREDIENTS` suit le
 * meme patron — ce n'est pas une donnee METIER chiffree (CLAUDE.md §7 ne vise
 * que les taux, seuils et montants reglementaires, avec date de validite et
 * source), c'est un lexique d'aide a la recherche, au meme titre qu'un
 * dictionnaire de synonymes ne vit pas dans une table `parametre`.
 *
 * Toute fonction ici est PURE (regle d'architecture n°1) : aucune donnee
 * d'ingredient n'est lue, seules deux chaines de caracteres sont comparees.
 */

/**
 * Normalise une chaine pour la recherche : casse, accents, ligatures
 * francaises, apostrophes, espaces superflus.
 *
 * `œ`/`Æ` NE SONT PAS decomposes par la normalisation Unicode NFD (ce sont des
 * ligatures, pas des lettres accentuees) : sans le remplacement explicite,
 * rechercher « oeufs » ne trouverait jamais l'ingredient « Œufs », saisi avec
 * la ligature typographique correcte (voir `CATALOGUE_ALLERGENES`, code
 * `oeufs`, libelle « Œufs »).
 *
 * L'apostrophe (droite ou typographique) devient un ESPACE et non une
 * suppression pure : « sirop d'érable » doit rester composé de TROIS mots
 * (« sirop », « d », « érable »), sinon il fusionnerait en « dérable », un mot
 * qu'aucune recherche ne saisira jamais.
 */
export function normaliserTexteRecherche(texte: string): string {
  // Diacritiques (accents) retirés via la propriété Unicode \p{Diacritic}
  // après décomposition NFD, plutôt qu'une plage de caractères littéraux :
  // aucun caractère accentué n'a besoin d'apparaître dans le code source.
  const sansAccents = texte
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

  // Ligatures françaises œ/æ, NON décomposées par NFD (ce sont des lettres à
  // part entière, pas des lettres accentuées) : sans ce remplacement,
  // rechercher « oeufs » ne trouverait jamais l'ingrédient « Œufs »
  // (voir `CATALOGUE_ALLERGENES`, code `oeufs`, libellé « Œufs »).
  //
  // Apostrophe typographique « ’ » (U+2019), à traiter comme l'apostrophe
  // droite : les deux saisies coexistent selon le clavier ou le copier-coller
  // depuis un document.
  //
  // `String.fromCodePoint` plutôt que le caractère littéral, pour la même
  // raison que ci-dessus : le point de code est explicite et grep-able.
  const oe = String.fromCodePoint(0x0153); // œ (toLowerCase a déjà réduit Œ à œ)
  const ae = String.fromCodePoint(0x00e6); // æ (toLowerCase a déjà réduit Æ à æ)
  const apostropheTypographique = String.fromCodePoint(0x2019); // ’

  return sansAccents
    .split(oe)
    .join('oe')
    .split(ae)
    .join('ae')
    .split(apostropheTypographique)
    .join(' ')
    .split("'")
    .join(' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Groupes de noms interchangeables pour une meme famille de denree, en
 * francais courant du marche et de la cuisine.
 *
 * FERME ET RESTREINT AU DOMAINE DE L'ACTIVITE (CLAUDE.md §6 : recettes R1/R2,
 * garnitures transformees et revendues), pas une tentative de dictionnaire de
 * synonymes general. Chaque groupe est ecrit une fois, dans sa graphie
 * courante ; `normaliserTexteRecherche` gere accents/casse a la comparaison,
 * inutile de repeter les variantes typographiques ici.
 *
 * Extensible : un nouveau groupe s'ajoute sans toucher a la logique de
 * correspondance ci-dessous.
 */
export const CATALOGUE_SYNONYMES_INGREDIENTS: readonly (readonly string[])[] = [
  // Sucres — R1 utilise la vergeoise blonde (CLAUDE.md §6) ; c'est l'exemple
  // meme donne par la fiche 09.
  ['vergeoise', 'cassonade', 'sucre roux', 'sucre brun'],
  ['sucre vanille', 'sucre vanillé', 'sucre a la vanille'],
  // Farines — R1 est au froment, R2 au sarrasin (CLAUDE.md §6).
  ['froment', 'ble tendre', 'farine de ble'],
  ['sarrasin', 'ble noir'],
  ['chataigne', 'marron'],
  // Produits laitiers et matiere grasse.
  ['creme fraiche', 'creme fleurette', 'creme liquide'],
  ['beurre noisette', 'beurre clarifie'],
  // Garnitures et produits revendus (docs/02 § « nature » — produits
  // transformes ET revendus partagent le meme referentiel `ingredient`).
  ['pate a tartiner', 'nutella', 'pate chocolat noisette'],
  ['chocolat en pepites', 'pepites de chocolat', 'pistoles de chocolat'],
  ['sucre glace', 'sucre impalpable', 'sucre en poudre fine'],
  ['noix de coco rapee', 'coco rapee'],
  ['amandes effilees', 'amandes en lamelles'],
  ['sirop d erable', 'sirop erable'],
  ['eau de fleur d oranger', 'fleur d oranger'],
] as const;

/**
 * Un ingredient dont le nom normalise contient `fragment` correspond-il a la
 * recherche `fragment`, en tenant compte des synonymes courants ?
 *
 * Trois niveaux, du plus direct au plus indirect :
 *  1. recherche vide -> tout correspond (pas de filtre saisi) ;
 *  2. correspondance DIRECTE : le nom contient la recherche telle quelle
 *     (apres normalisation) — c'est le cas de loin le plus frequent ;
 *  3. correspondance PAR SYNONYME : la recherche designe un membre d'un
 *     groupe du catalogue, et le nom contient un AUTRE membre du MEME groupe.
 *     C'est ce troisieme niveau qui evite le doublon « vergeoise » /
 *     « cassonade » decrit par la fiche 09.
 *
 * Symetrique par construction : chercher « vergeoise » trouve un ingredient
 * nomme « Cassonade brute », et inversement — aucun des deux sens n'est
 * privilegie.
 */
export function ingredientCorrespondALaRecherche(
  nomIngredient: string,
  recherche: string,
): boolean {
  const nomNormalise = normaliserTexteRecherche(nomIngredient);
  const rechercheNormalisee = normaliserTexteRecherche(recherche);

  if (rechercheNormalisee === '') return true;
  if (nomNormalise.includes(rechercheNormalisee)) return true;

  return CATALOGUE_SYNONYMES_INGREDIENTS.some((groupe) => {
    const rechercheDesigneCeGroupe = groupe.some((membre) =>
      normaliserTexteRecherche(membre).includes(rechercheNormalisee),
    );
    if (!rechercheDesigneCeGroupe) return false;

    return groupe.some((membre) => nomNormalise.includes(normaliserTexteRecherche(membre)));
  });
}
