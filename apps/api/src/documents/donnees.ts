/**
 * Assemblage des donnees de chaque document : base -> forme attendue par un
 * gabarit ou par un export Excel.
 *
 * Pourquoi un fichier a part plutot que dans `routes/documents.ts` : les
 * gabarits (`gabarits.ts`, `registre-afsca.ts`) et les exports (`excel.ts`)
 * sont volontairement des fonctions PURES qui ne connaissent pas la base. Il
 * faut donc bien un endroit qui lise la base et remplisse leurs types d'entree.
 * Le mettre ici garde chaque route reduite a ce qu'elle est : une adresse HTTP,
 * un type MIME, un nom de fichier.
 *
 * Rien ici ne CALCULE (CLAUDE.md §3 regle n°1). Les chiffres viennent des
 * depots de `@batte/db` ou des fonctions pures de `@batte/core`
 * (`mettreAEchelle`) ; ce module ne fait qu'assembler et renommer.
 */

import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  chargerRecettePourCalcul,
  etatDuStock,
  executionsNettoyagePeriode,
  lireParametres,
  lireProductionDetail,
  lireRecetteDetail,
  lireSessionDetail,
  listerExercicesTracabilite,
  nonConformitesPeriode,
  relevesTemperaturePeriode,
  schema,
  sessionsSansReleveTemperature,
  tachesEnRetard,
  tracabiliteAvalLot,
  type BaseBatte,
} from '@batte/db';
import { ErreurIntrouvable, jourCivilBelge, mettreAEchelle } from '@batte/core';
import type {
  DonneesAffichette,
  DonneesEtiquette,
  DonneesFicheTechnique,
  DonneesRapportSession,
} from './gabarits.js';
import type {
  DonneesRegistreAfsca,
  DonneesRegistreAfscaExploitant,
  DonneesRegistreAfscaLotConcerne,
} from './registre-afsca.js';
import type { DonneesFicheRappelLot } from './fiche-rappel.js';
import type {
  DonneesExportJournalAchats,
  DonneesExportJournalRecettes,
  DonneesExportMouvements,
  DonneesExportStock,
} from './excel.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Bornes de periode

   Une date metier est stockee tantot en jour civil (`2026-07-15`), tantot en
   ISO complet selon la table. Une borne haute nue (`2026-07-31`) exclurait donc
   silencieusement `2026-07-31T09:00:00.000Z`, qui lui est POSTERIEUR en
   comparaison de chaines. La borne basse, elle, doit rester nue : un jour civil
   `2026-07-01` est INFERIEUR a `2026-07-01T00:00:00.000Z` (prefixe plus court).
   ═══════════════════════════════════════════════════════════════════════════ */

/** Borne haute inclusive tolerante au jour civil comme a l'ISO complet. */
function finDeJournee(jourCivil: string): string {
  return `${jourCivil}T23:59:59.999Z`;
}

/** Dernier jour civil du mois : `2026-02` -> `2026-02-28`. */
export function dernierJourDuMois(annee: number, mois: number): string {
  // `Date.UTC(annee, mois, 0)` = jour 0 du mois SUIVANT = dernier jour du mois
  // demande, bissextiles comprises.
  const date = new Date(Date.UTC(annee, mois, 0));
  return date.toISOString().slice(0, 10);
}

/** « Juillet 2026 » — libelle de periode du registre AFSCA. */
export function libellePeriodeMensuelle(annee: number, mois: number): string {
  const brut = new Intl.DateTimeFormat('fr-BE', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(annee, mois - 1, 1)));
  return brut.charAt(0).toUpperCase() + brut.slice(1);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Verification des allergenes — utilitaire partage entre les documents
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Vrai si TOUS les ingredients identifies ont ete evalues
 * (`ingredient.allergenes_verifies`, migration 0024).
 *
 * Doctrine « une valeur inconnue ne vaut jamais zero » (CLAUDE.md), appliquee
 * a la securite alimentaire : un SEUL ingredient jamais evalue rend la liste
 * d'allergenes d'un document PARTIELLEMENT fondee — donc pas presentable
 * comme une liste. Un document doit alors avertir « non encore verifies »,
 * jamais afficher ce qu'il connait comme si c'etait tout ce qu'il y a a
 * connaitre (CLAUDE.md §7).
 *
 * Vrai par vacuite sur une liste vide : un produit qui ne cite aucun
 * ingredient (un menu sans composant, cas limite) n'a rien a faire verifier.
 * Faux si un identifiant ne resout a AUCUNE ligne : ce serait une incoherence
 * referentielle, qu'on ne recompense pas d'un « verifie » par defaut.
 */
function tousLesIngredientsVerifies(base: BaseBatte, ingredientIds: readonly string[]): boolean {
  const identifiants = [...new Set(ingredientIds)];
  if (identifiants.length === 0) return true;

  const lignes = base
    .select({ verifie: schema.ingredient.allergenesVerifies })
    .from(schema.ingredient)
    .where(inArray(schema.ingredient.id, identifiants))
    .all();

  return lignes.length === identifiants.length && lignes.every((l) => l.verifie);
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. Fiche technique de recette
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Fiche technique au rendement de REFERENCE de la recette : c'est la version
 * qu'on affiche a l'ecran et qu'on affiche en cuisine, pas une mise a l'echelle
 * ponctuelle. Les quantites et le cout viennent de `mettreAEchelle`, fonction
 * pure et testee de `@batte/core`.
 */
export function donneesFicheTechnique(
  base: BaseBatte,
  recetteId: string,
): DonneesFicheTechnique | null {
  const detail = lireRecetteDetail(base, recetteId);
  const pourCalcul = chargerRecettePourCalcul(base, recetteId);
  if (detail === null || pourCalcul === null) return null;

  const resultat = mettreAEchelle(pourCalcul, {
    type: 'volume',
    volumeMl: pourCalcul.rendementReferenceMl,
  });

  // Note du GESTE par ligne (`recette_ligne.note_technique`) : `mettreAEchelle`
  // (`@batte/core`, fonction PURE de mise à l'échelle, règle d'architecture
  // n°1) ne la porte pas — ce n'est pas une donnée calculée, juste un texte
  // attaché à l'ingrédient. On la relit donc depuis `detail.lignes` (déjà
  // résolu par `lireRecetteDetail` ci-dessus) et on l'assemble ICI, par
  // ingrédient, sans toucher au moteur de calcul.
  const notesTechniquesParIngredient = new Map(
    detail.lignes.map((l) => [l.ingredientId, l.noteTechnique]),
  );

  return {
    code: detail.code,
    nom: detail.nom,
    version: detail.version,
    sansGluten: detail.sansGluten,
    rendementMl: detail.rendementReferenceMl,
    rendementCrepes: detail.rendementReferenceCrepes,
    procede: detail.procede,
    lignes: resultat.lignes.map((l) => ({
      nomIngredient: l.nomIngredient,
      quantite: l.quantite,
      unite: l.unite,
      coutCents: l.coutCents,
      // `?? null` couvre aussi bien une note réellement absente qu'un
      // ingrédient introuvable dans `detail.lignes` (incohérence interne
      // improbable) : dans les deux cas, « aucune note » est le seul rendu
      // honnête, jamais une note fabriquée.
      noteTechnique: notesTechniquesParIngredient.get(l.ingredientId) ?? null,
    })),
    coutMatiereCents: resultat.coutMatiereCents,
    coutParCrepeCents: detail.coutParCrepeCents,
    allergenes: resultat.allergenes,
    // Vrai seulement si CHAQUE ingredient de la recette a ete evalue : un seul
    // qui ne l'est pas rend la liste ci-dessus partiellement fondee.
    allergenesVerifies: tousLesIngredientsVerifies(
      base,
      pourCalcul.lignes.map((l) => l.ingredientId),
    ),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. Affichette allergenes — OBLIGATION D'AFFICHAGE
   ═══════════════════════════════════════════════════════════════════════════ */

/** Union triee et dedoublonnee de plusieurs listes d'allergenes. */
function fusionnerAllergenes(listes: readonly (readonly string[])[]): string[] {
  const ensemble = new Set<string>();
  for (const liste of listes) {
    for (const allergene of liste) ensemble.add(allergene);
  }
  return [...ensemble].sort((a, b) => a.localeCompare(b, 'fr-BE'));
}

/**
 * Affichette a poser sur le stand.
 *
 * Un produit TRANSFORME porte les allergenes de sa recette ET ceux de ses
 * garnitures : une crepe au sirop de Liege sur pate froment doit declarer le
 * gluten de la pate comme les fruits a coque eventuels de la garniture. Un
 * produit REVENDU porte ceux de l'article achete tel quel. Omettre les
 * garnitures serait une information incomplete au consommateur, ce qui est
 * exactement ce que la reglementation interdit.
 *
 * Un produit porte AUSSI les allergenes de sa nomenclature de VENTE
 * (`produit_vente_composant`, fiche 15) — le cafe, notamment, n'a ni recette
 * ni garniture, seulement des composants. Mais tous les composants ne se
 * valent pas : un composant `optionnel` (la creme, servie seulement si le
 * client la demande) ne fait PAS partie du produit de base. Le compter dans
 * la meme liste ferait declarer « lait » sur un cafe noir qui n'en contient
 * pas — trop large, ce qui decredibilise l'affichette entiere autant qu'un
 * oubli. Il figure donc a part, sous « sur demande ».
 *
 * GARDE-FOU (CLAUDE.md §7) : la distinction est PUREMENT ADDITIVE. Les
 * allergenes obligatoires (recette + garnitures + composants NON optionnels +
 * article revendu) ne perdent jamais un allergene a cause de cette
 * distinction — seule la liste « sur demande » peut se reduire, jamais la
 * liste principale. Dans le doute, un allergene de trop sur la liste
 * principale reste toujours moins grave qu'un allergene manquant.
 *
 * Seuls les produits ACTIFS figurent : afficher un produit retire de la carte
 * ferait douter le client de tout le reste du panneau. Seuls les composants
 * ACTIFS entrent en compte : un composant desactive ne sort plus du stock, il
 * ne doit donc plus figurer sur l'affichette non plus.
 */
/**
 * Une contribution d'allergenes a un produit, portee par un seul ingredient :
 * ce qu'il declare, ET si quelqu'un l'a reellement evalue.
 *
 * Fusionner les deux dans le meme objet evite de faire vivre deux structures
 * paralleles (une pour les listes, une pour les drapeaux) qui pourraient
 * diverger silencieusement au fil des modifications de cette fonction.
 */
type ContributionAllergene = { readonly allergenes: readonly string[]; readonly verifie: boolean };

/**
 * Vrai si TOUTES les contributions rassemblees pour un produit sont
 * verifiees. Vrai par vacuite : un produit sans aucune contribution n'a rien
 * a faire verifier (voir `tousLesIngredientsVerifies` ci-dessus, meme regle).
 */
function toutesVerifiees(contributions: readonly ContributionAllergene[]): boolean {
  return contributions.every((c) => c.verifie);
}

export function donneesAffichetteAllergenes(base: BaseBatte): DonneesAffichette {
  const produits = base
    .select()
    .from(schema.produitVente)
    .where(eq(schema.produitVente.actif, true))
    .orderBy(asc(schema.produitVente.nom))
    .all();

  const parRecette = new Map<string, ContributionAllergene[]>();
  for (const ligne of base
    .select({
      recetteId: schema.recetteLigne.recetteId,
      allergenes: schema.ingredient.allergenes,
      allergenesVerifies: schema.ingredient.allergenesVerifies,
    })
    .from(schema.recetteLigne)
    .innerJoin(schema.ingredient, eq(schema.recetteLigne.ingredientId, schema.ingredient.id))
    .all()) {
    const contributions = parRecette.get(ligne.recetteId) ?? [];
    contributions.push({ allergenes: ligne.allergenes, verifie: ligne.allergenesVerifies });
    parRecette.set(ligne.recetteId, contributions);
  }

  const parGarniture = new Map<string, ContributionAllergene[]>();
  for (const ligne of base
    .select({
      produitVenteId: schema.produitGarniture.produitVenteId,
      allergenes: schema.ingredient.allergenes,
      allergenesVerifies: schema.ingredient.allergenesVerifies,
    })
    .from(schema.produitGarniture)
    .innerJoin(schema.ingredient, eq(schema.produitGarniture.ingredientId, schema.ingredient.id))
    .all()) {
    const contributions = parGarniture.get(ligne.produitVenteId) ?? [];
    contributions.push({ allergenes: ligne.allergenes, verifie: ligne.allergenesVerifies });
    parGarniture.set(ligne.produitVenteId, contributions);
  }

  const parIngredient = new Map<string, ContributionAllergene>();
  for (const ligne of base
    .select({
      id: schema.ingredient.id,
      allergenes: schema.ingredient.allergenes,
      allergenesVerifies: schema.ingredient.allergenesVerifies,
    })
    .from(schema.ingredient)
    .all()) {
    parIngredient.set(ligne.id, {
      allergenes: ligne.allergenes,
      verifie: ligne.allergenesVerifies,
    });
  }

  // Composants de nomenclature de VENTE (fiche 15), ACTIFS uniquement,
  // scindes en deux cartes selon `optionnel` — c'est cette scission qui
  // permet a l'affichette de dire « sur demande » plutot que d'unir en
  // silence toutes les listes possibles.
  const parComposantObligatoire = new Map<string, ContributionAllergene[]>();
  const parComposantOptionnel = new Map<string, ContributionAllergene[]>();
  for (const ligne of base
    .select({
      produitVenteId: schema.produitVenteComposant.produitVenteId,
      optionnel: schema.produitVenteComposant.optionnel,
      allergenes: schema.ingredient.allergenes,
      allergenesVerifies: schema.ingredient.allergenesVerifies,
    })
    .from(schema.produitVenteComposant)
    .innerJoin(
      schema.ingredient,
      eq(schema.produitVenteComposant.ingredientId, schema.ingredient.id),
    )
    .where(eq(schema.produitVenteComposant.actif, true))
    .all()) {
    const carte = ligne.optionnel ? parComposantOptionnel : parComposantObligatoire;
    const contributions = carte.get(ligne.produitVenteId) ?? [];
    contributions.push({ allergenes: ligne.allergenes, verifie: ligne.allergenesVerifies });
    carte.set(ligne.produitVenteId, contributions);
  }

  /**
   * MENUS (fiche 16) : un menu est un `produit_vente` dont `recetteId` ET
   * `ingredientId` valent NULL (`depots/referentiel.ts`) — sans cette
   * resolution, un menu « crêpe + café » afficherait « aucun allergène
   * déclaré » alors que la crêpe contient du gluten. C'est l'omission la
   * plus grave que cette affichette puisse commettre (CLAUDE.md §7 : dans
   * le doute, un allergène de trop vaut mieux qu'un allergène manquant).
   *
   * `menu_composition` ne relie jamais un menu a un AUTRE menu
   * (`verifierPasMenuImbrique`, `depots/menus.ts`) : un seul niveau de
   * resolution suffit, les listes ci-dessus (recette, garniture, composant,
   * ingredient revendu) couvrent deja tout ce qu'un produit inclus peut
   * porter.
   */
  const produitsPourMenus = new Map<
    string,
    { recetteId: string | null; ingredientId: string | null }
  >();
  for (const p of base
    .select({
      id: schema.produitVente.id,
      recetteId: schema.produitVente.recetteId,
      ingredientId: schema.produitVente.ingredientId,
    })
    .from(schema.produitVente)
    .all()) {
    produitsPourMenus.set(p.id, { recetteId: p.recetteId, ingredientId: p.ingredientId });
  }

  const parMenuObligatoire = new Map<string, ContributionAllergene[]>();
  const parMenuOptionnel = new Map<string, ContributionAllergene[]>();
  for (const ligne of base
    .select({
      menuId: schema.menuComposition.menuId,
      produitInclusId: schema.menuComposition.produitInclusId,
    })
    .from(schema.menuComposition)
    .where(eq(schema.menuComposition.actif, true))
    .all()) {
    // Reference orpheline improbable (integrite referentielle en base), mais
    // une affichette ne doit jamais planter sur un cas limite : elle passe.
    const inclus = produitsPourMenus.get(ligne.produitInclusId);
    if (inclus === undefined) continue;

    const obligatoires = parMenuObligatoire.get(ligne.menuId) ?? [];
    if (inclus.recetteId !== null) obligatoires.push(...(parRecette.get(inclus.recetteId) ?? []));
    obligatoires.push(...(parGarniture.get(ligne.produitInclusId) ?? []));
    obligatoires.push(...(parComposantObligatoire.get(ligne.produitInclusId) ?? []));
    if (inclus.ingredientId !== null) {
      const contribution = parIngredient.get(inclus.ingredientId);
      if (contribution !== undefined) obligatoires.push(contribution);
    }
    parMenuObligatoire.set(ligne.menuId, obligatoires);

    // Le composant inclus peut lui-meme porter des options « sur demande »
    // (le cafe d'un menu crêpe+café garde sa crème en option) : elles restent
    // « sur demande » une fois remontees au niveau du menu.
    const optionnels = parMenuOptionnel.get(ligne.menuId) ?? [];
    optionnels.push(...(parComposantOptionnel.get(ligne.produitInclusId) ?? []));
    parMenuOptionnel.set(ligne.menuId, optionnels);
  }

  return {
    produits: produits.map((p) => {
      const contributions: ContributionAllergene[] = [];
      if (p.recetteId !== null) contributions.push(...(parRecette.get(p.recetteId) ?? []));
      contributions.push(...(parGarniture.get(p.id) ?? []));
      contributions.push(...(parComposantObligatoire.get(p.id) ?? []));
      if (p.ingredientId !== null) {
        const contribution = parIngredient.get(p.ingredientId);
        if (contribution !== undefined) contributions.push(contribution);
      }
      contributions.push(...(parMenuObligatoire.get(p.id) ?? []));
      const allergenes = fusionnerAllergenes(contributions.map((c) => c.allergenes));
      // Un SEUL ingredient obligatoire jamais evalue rend cette liste
      // partiellement fondee : l'affichette doit alors le dire plutot que de
      // presenter ce qu'elle connait comme si c'etait tout ce qu'il y a a
      // savoir (CLAUDE.md §7, meme doctrine que `tousLesIngredientsVerifies`).
      const allergenesVerifies = toutesVerifiees(contributions);

      // « Sur demande » : uniquement les allergenes des options qui
      // n'apparaissent PAS deja dans la liste principale — un cafe qui
      // contient deja du lait dans sa base n'a pas besoin qu'on le repete au
      // pretexte que la creme (optionnelle) en apporte aussi.
      const dejaDeclares = new Set(allergenes);
      const optionsPossibles = [
        ...(parComposantOptionnel.get(p.id) ?? []),
        ...(parMenuOptionnel.get(p.id) ?? []),
      ];
      const allergenesSurDemande = fusionnerAllergenes(
        optionsPossibles.map((c) => c.allergenes),
      ).filter((allergene) => !dejaDeclares.has(allergene));

      return { nom: p.nom, allergenes, allergenesVerifies, allergenesSurDemande };
    }),
    dateGeneration: new Date(),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. Etiquette de bac de pate
   ═══════════════════════════════════════════════════════════════════════════ */

export function donneesEtiquetteBac(
  base: BaseBatte,
  productionId: string,
): DonneesEtiquette | null {
  const detail = lireProductionDetail(base, productionId);
  if (detail === null) return null;

  // `lireProductionDetail` ne rend pas l'identifiant de recette : les
  // allergenes se lisent donc en repartant de la recette exacte — la VERSION
  // consommee ce jour-la, pas la version courante (une recette active est
  // immuable, D-005, c'est ce qui rend l'etiquette opposable).
  const entete = base
    .select({ recetteId: schema.production.recetteId })
    .from(schema.production)
    .where(eq(schema.production.id, productionId))
    .get();
  const recette = entete === undefined ? null : lireRecetteDetail(base, entete.recetteId);

  return {
    numeroLotPate: detail.numeroLotPate,
    recetteCode: detail.recetteCode,
    recetteNom: detail.recetteNom,
    dateProduction: detail.dateProduction,
    dateDlc: detail.dateDlcPate,
    volumeMl: detail.volumeReelMl ?? detail.volumeTheoriqueMl,
    allergenes:
      recette === null ? [] : fusionnerAllergenes(recette.lignes.map((l) => l.allergenes)),
    /**
     * `false` quand la recette n'a pas pu etre resolue : on ne sait alors PAS
     * ce que contient le bac, donc on ne peut certainement pas affirmer que
     * ses allergenes sont verifies. Jamais `true` par defaut sur une
     * incoherence interne.
     */
    allergenesVerifies:
      recette !== null &&
      tousLesIngredientsVerifies(
        base,
        recette.lignes.map((l) => l.ingredientId),
      ),
  };
}

/* Le bon de commande (document n°4) n'est PAS assemble ici : sa fonction vit
   dans `routes/commandes.ts`, ou elle sert a la fois l'apercu et la piece
   jointe du mail. Deux assemblages divergents produiraient deux documents
   differents pour un meme numero de commande (D-009). */

/* ═══════════════════════════════════════════════════════════════════════════
   6. Rapport de session
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Rapport d'une session close.
 *
 * Les montants nullables du detail (`caTotalCents` et consorts restent `null`
 * tant que la session n'est pas cloturee) sont ramenes a zero ICI et nulle part
 * ailleurs : le gabarit attend des entiers. La route refuse de toute facon une
 * session non cloturee — un rapport de session ouverte serait un chiffre
 * provisoire presente comme un resultat.
 */
export function donneesRapportSession(
  base: BaseBatte,
  sessionId: string,
): DonneesRapportSession | null {
  const detail = lireSessionDetail(base, sessionId);
  if (detail === null) return null;

  const fraisTotauxCents =
    detail.fraisEmplacementCents +
    detail.fraisDeplacementCents +
    detail.fraisGazCents +
    detail.fraisDiversCents;

  return {
    numero: detail.numero,
    lieuNom: detail.lieuNom,
    dateSession: detail.dateSession,
    ventes: detail.ventes.map((v) => ({
      nomProduit: v.nomProduit,
      quantite: v.quantite,
      prixUnitaireCents: v.prixUnitaireCents,
      montantCents: v.montantCents,
    })),
    caTotalCents: detail.caTotalCents ?? 0,
    caTransformeCents: detail.caTransformeCents ?? 0,
    caRevenduCents: detail.caRevenduCents ?? 0,
    caEspecesCents: detail.caEspecesCents ?? 0,
    caCarteCents: detail.caCarteCents ?? 0,
    ecartCaisseCents: detail.ecartCaisseCents ?? 0,
    coutMatiereCents: detail.coutMatiereCents ?? 0,
    commissionCarteCents: detail.commissionCarteCents ?? 0,
    fraisTotauxCents,
    margeBruteCents: detail.margeBruteCents ?? 0,
    margeNetteCents: detail.margeNetteCents ?? 0,
    margeParHeureCents: detail.margeParHeureCents,
    crepesProduites: detail.crepesProduites,
    crepesVendues: detail.crepesVendues,
    crepesInvendues: detail.crepesInvendues,
    crepesCassees: detail.crepesCassees,
    /**
     * `null` se transmet TEL QUEL, jamais `?? 0`.
     *
     * Une session qui ne vend que du revendu n'a produit aucune crepe : le taux
     * d'ecoulement n'y a pas de sens. Imprimer « 0 % » ferait lire un invendu
     * TOTAL la ou la question ne se pose meme pas — et sur un document, ce
     * contresens se lit hors contexte, sans possibilite de verifier.
     */
    tauxEcoulementBp: detail.tauxEcoulementBp,
    notesQualitatives: detail.notesQualitatives,
  };
}

/** Statut d'une session, pour que la route sache si un rapport a un sens. */
export function statutSession(base: BaseBatte, sessionId: string): string | null {
  const ligne = base
    .select({ statut: schema.sessionMarche.statut })
    .from(schema.sessionMarche)
    .where(eq(schema.sessionMarche.id, sessionId))
    .get();
  return ligne?.statut ?? null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. Registre AFSCA mensuel — la seule sortie opposable a un controle
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Résout, pour un ensemble de non-conformités, le lot précis auquel chacune
 * est éventuellement rattachée.
 *
 * `nonConformitesPeriode` (`@batte/db`) rend la ligne brute (`lotId` compris)
 * mais ne joint pas le lot : ce module fait l'assemblage, comme il le fait
 * déjà pour les allergènes de produit (§2). Sans cette résolution, le champ
 * `lot_id` — désormais alimenté par un rappel fournisseur ou une déclaration
 * manuelle (`RegistreAfsca.tsx`) — reste dans la base sans jamais apparaître
 * sur le document présenté à un contrôle : le registre imprimé mentirait par
 * omission sur ce que la base sait déjà.
 *
 * DÉFAUT CORRIGÉ (audit du 30/07/2026) : `statut`, `motifStatutLibelle` et
 * `dateChangementStatut` existent sur `lot` (écrits par `changerStatutLot`,
 * `packages/db/src/services/mouvements.ts`) et le gabarit du registre
 * (`registre-afsca.ts`) savait déjà les afficher — mais cette fonction ne les
 * lisait pas, donc ils ne s'imprimaient jamais. Un lot bloqué s'affichait
 * donc « bloqué », sans jamais dire pourquoi ni depuis quand : exactement la
 * première question qu'un contrôle pose. Même triple lecture que
 * `tracabiliteAvalLot` (`packages/db/src/depots/tracabilite.ts`) : `statut`
 * est TOUJOURS connu (colonne `NOT NULL`), le motif et sa date restent `null`
 * pour un lot qui n'a jamais changé de statut depuis sa réception — jamais un
 * motif fabriqué (CLAUDE.md §7).
 *
 * DÉFAUT CORRIGÉ (audit du 31/07/2026) : `schema.fournisseur` n'était jamais
 * joint ici, alors que `lot.fournisseurId` (`NOT NULL`) le permet directement
 * — inutile de passer par `reception`. Sans cette jointure, un « rappel
 * fournisseur » imprimé sur le registre ne disait jamais CHEZ QUI rappeler.
 * `innerJoin`, pas `leftJoin` : la colonne est `NOT NULL`, un lot sans
 * fournisseur n'existe pas — même choix que la jointure identique du journal
 * des achats un peu plus bas dans ce fichier (`donneesJournalAchats`).
 */
function resoudreLotsConcernes(
  base: BaseBatte,
  lotIds: readonly string[],
): Map<string, DonneesRegistreAfscaLotConcerne> {
  const identifiants = [...new Set(lotIds)];
  const carte = new Map<string, DonneesRegistreAfscaLotConcerne>();
  if (identifiants.length === 0) return carte;

  for (const ligne of base
    .select({
      id: schema.lot.id,
      ingredientNom: schema.ingredient.nom,
      fournisseurNom: schema.fournisseur.nom,
      numeroLotFournisseur: schema.lot.numeroLotFournisseur,
      dateDlc: schema.lot.dateDlc,
      statut: schema.lot.statut,
      // `leftJoin` : `lot.motif_statut_id` est nullable (aucun changement de
      // statut depuis la reception, le cas courant) — un `innerJoin` ferait
      // silencieusement disparaitre ces lots du registre, meme jointure que
      // `tracabiliteAvalLot`.
      motifStatutLibelle: schema.motif.libelle,
      dateChangementStatut: schema.lot.dateChangementStatut,
    })
    .from(schema.lot)
    .innerJoin(schema.ingredient, eq(schema.lot.ingredientId, schema.ingredient.id))
    .innerJoin(schema.fournisseur, eq(schema.lot.fournisseurId, schema.fournisseur.id))
    .leftJoin(schema.motif, eq(schema.lot.motifStatutId, schema.motif.id))
    .where(inArray(schema.lot.id, identifiants))
    .all()) {
    carte.set(ligne.id, {
      ingredientNom: ligne.ingredientNom,
      fournisseurNom: ligne.fournisseurNom,
      numeroLotFournisseur: ligne.numeroLotFournisseur,
      dateDlc: ligne.dateDlc,
      statut: ligne.statut,
      motifStatutLibelle: ligne.motifStatutLibelle,
      dateChangementStatut: ligne.dateChangementStatut,
    });
  }
  return carte;
}

/**
 * Identité de l'exploitant (audit `docs/31-DOCUMENTS-OUVERTS.md` §5 : « aucune
 * notion d'exploitant n'existait nulle part dans le dépôt »). Lue À LA DATE
 * D'ÉDITION du document (aujourd'hui), pas à la date de la période couverte ni
 * à celle d'un événement passé : c'est l'exploitant ACTUEL qu'un contrôle
 * rapproche du document, même sur un document réédité pour une période ou un
 * lot ancien — même choix que `tachesEnRetard(base, jourCivilBelge(new Date()))`
 * plus bas dans ce fichier.
 *
 * `.texteOuNull(...)` traduit la convention de stockage (chaîne vide = non
 * renseigné) en `null` pour le gabarit, qui doit alors imprimer un repère
 * d'absence PAR CHAMP plutôt qu'une valeur fabriquée (CLAUDE.md §7).
 *
 * Factorisé le 01/08/2026 : la fiche de rappel (`fiche-rappel.ts`) lit la
 * MÊME identité que le registre AFSCA — une seule lecture, jamais deux
 * copies qui pourraient diverger.
 */
function lireExploitant(base: BaseBatte): DonneesRegistreAfscaExploitant {
  const parametres = lireParametres(base, jourCivilBelge(new Date()));
  return {
    nom: parametres.texteOuNull('exploitant_nom'),
    adresse: parametres.texteOuNull('exploitant_adresse'),
    numeroEntreprise: parametres.texteOuNull('exploitant_numero_entreprise'),
    numeroEnregistrementAfsca: parametres.texteOuNull('exploitant_numero_enregistrement_afsca'),
  };
}

export function donneesRegistreAfsca(
  base: BaseBatte,
  annee: number,
  mois: number,
): DonneesRegistreAfsca {
  const debut = `${String(annee).padStart(4, '0')}-${String(mois).padStart(2, '0')}-01`;
  const fin = finDeJournee(dernierJourDuMois(annee, mois));

  // `listerExercicesTracabilite` ne prend pas de bornes (le registre est son
  // seul lecteur borne) : le filtre se fait ici, sur un volume de quelques
  // lignes par an.
  const exercices = listerExercicesTracabilite(base).filter(
    (e) => e.dateExercice >= debut && e.dateExercice <= fin,
  );

  const nonConformites = nonConformitesPeriode(base, debut, fin);
  const lotsConcernes = resoudreLotsConcernes(
    base,
    nonConformites.map((n) => n.lotId).filter((id): id is string => id !== null),
  );

  const exploitant = lireExploitant(base);

  return {
    periodeLibelle: libellePeriodeMensuelle(annee, mois),
    dateGeneration: new Date(),
    exploitant,
    temperatures: relevesTemperaturePeriode(base, debut, fin).map((t) => ({
      dateReleve: t.dateReleve,
      // La date de SAISIE réelle voyage avec la date métier. CLAUDE.md §7 : le
      // registre enregistre ce qui a été saisi, avec sa date de saisie réelle.
      // Le gabarit n'imprime la mention que lorsque les deux jours diffèrent.
      creeLe: t.creeLe,
      moment: t.moment,
      equipement: t.equipement,
      temperatureC: t.temperatureC,
      conforme: t.conforme,
      actionCorrective: t.actionCorrective,
      // Les DEUX relevés d'une correction restent visibles au registre (D-083,
      // 31/07/2026) : le mauvais s'imprime barré, avec son motif et sa date
      // d'annulation — `relevesTemperaturePeriode` les retrouve déjà dans le
      // journal d'audit (`packages/db/src/services/afsca.ts`), rien à calculer
      // ici (CLAUDE.md §3 règle 1).
      statut: t.statut,
      motifAnnulation: t.motifAnnulation,
      dateAnnulation: t.dateAnnulation,
    })),
    nettoyages: executionsNettoyagePeriode(base, debut, fin).map((n) => ({
      dateExecution: n.dateExecution,
      creeLe: n.creeLe,
      tacheLibelle: n.tacheLibelle,
      zone: n.zone,
      executePar: n.executePar,
      observations: n.observations,
    })),
    nonConformites: nonConformites.map((n) => ({
      dateConstat: n.dateConstat,
      type: n.type,
      description: n.description,
      gravite: n.gravite,
      actionCorrective: n.actionCorrective,
      dateResolution: n.dateResolution,
      lot: n.lotId === null ? null : (lotsConcernes.get(n.lotId) ?? null),
    })),
    exercicesTracabilite: exercices
      .map((e) => ({
        dateExercice: e.dateExercice,
        dureeMinutes: e.dureeMinutes,
        resultat: e.resultat,
        ecartsConstates: e.ecartsConstates,
      }))
      // Le registre se lit dans l'ordre chronologique, comme ses quatre autres
      // sections ; `listerExercicesTracabilite` trie du plus recent au plus ancien.
      .reverse(),
    /**
     * Les deux sections qui montrent les TROUS, et non seulement ce qui existe.
     *
     * Un registre qui n'imprime que les lignes saisies donne une fausse
     * impression de completude : trois semaines manquantes se lisent exactement
     * comme trois semaines sans incident. Ces deux champs existaient dans le
     * gabarit sans etre alimentes ici — donc les sections ne s'imprimaient
     * jamais, et le calcul ne servait a rien.
     *
     * On renseigne toujours un TABLEAU, jamais `undefined` : la convention du
     * gabarit reserve `undefined` au cas « verification pas faite », et ici elle
     * l'est. Un tableau vide dit « verifie, aucun trou » — ce qui est une
     * information, alors que le silence n'en est pas une.
     */
    sessionsSansReleveTemperature: sessionsSansReleveTemperature(base, debut, fin).map((s) => ({
      numero: s.numero,
      dateSession: s.dateSession,
      lieuNom: s.lieuNom,
    })),
    // A la date d'EDITION, pas a la fin de la periode : un retard de nettoyage
    // est un etat courant, pas un fait historique, et `tachesEnRetard` raisonne
    // sur la derniere execution connue aujourd'hui. Le gabarit imprime cette
    // nuance en clair (« a la date d'edition du registre »), donc le lecteur ne
    // peut pas confondre les deux horizons.
    tachesNettoyageEnRetard: tachesEnRetard(base, jourCivilBelge(new Date())).map((t) => ({
      libelle: t.libelle,
      zone: t.zone,
      derniereExecution: t.derniereExecution,
      motif: t.motif,
    })),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   7bis. Fiche de rappel — traçabilité AVAL d'un lot (document DÉDIÉ)

   Voir le docblock de `fiche-rappel.ts` pour l'argument complet : un lot ne
   tient pas dans un mois civil, ni dans une section du registre mensuel.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Assemble la fiche de rappel d'un lot : lot fournisseur -> productions ->
 * lots de pâte -> sessions, ET lot -> ventes/garnitures directes.
 *
 * `tracabiliteAvalLot` (`@batte/db`) porte déjà TOUTE la traçabilité — y
 * compris `numeroLotPate`, le champ que le rappel réclame (voir son
 * commentaire, `packages/db/src/depots/tracabilite.ts` : « DÉFAUT CORRIGÉ
 * (audit du 31/07/2026) »). Ce module ne fait qu'y ajouter l'unité de
 * l'ingrédient (absente du contrat de traçabilité, jamais recalculée ici) et
 * l'identité de l'exploitant — exactement comme `donneesRegistreAfsca`
 * ci-dessus, via la MÊME lecture (`lireExploitant`).
 *
 * `identifiant` accepte indifféremment l'identifiant technique du lot OU son
 * numéro fournisseur : `tracabiliteAvalLot` résout les deux (voir
 * `resoudreLotId`, `packages/db/src/depots/tracabilite.ts`) et lève
 * `ErreurIntrouvable`/`ErreurMetier` (numéro ambigu) si la résolution échoue —
 * cette fonction-ci n'a rien à ajouter à cette gestion d'erreur, elle la
 * laisse remonter telle quelle.
 */
export function donneesFicheRappelLot(base: BaseBatte, identifiant: string): DonneesFicheRappelLot {
  const aval = tracabiliteAvalLot(base, identifiant);

  // `tracabiliteAvalLot` vient de résoudre CET ingrédient via une jointure
  // INNER (`packages/db/src/depots/tracabilite.ts`) : son absence ici serait
  // une incohérence interne, jamais un cas métier — d'où `ErreurIntrouvable`
  // plutôt qu'un `null` qui se propagerait silencieusement dans le document.
  const ingredient = base
    .select({ uniteReference: schema.ingredient.uniteReference })
    .from(schema.ingredient)
    .where(eq(schema.ingredient.id, aval.ingredientId))
    .get();
  if (ingredient === undefined) throw new ErreurIntrouvable('Ingrédient', aval.ingredientId);

  return {
    dateGeneration: new Date(),
    exploitant: lireExploitant(base),
    ingredientNom: aval.ingredientNom,
    fournisseurNom: aval.fournisseurNom,
    numeroLotFournisseur: aval.numeroLotFournisseur,
    dateDlc: aval.dateDlc,
    unite: ingredient.uniteReference,
    dateReception: aval.dateReception,
    receptionNumero: aval.receptionNumero,
    receptionStatut: aval.receptionStatut,
    statut: aval.statut,
    motifStatutLibelle: aval.motifStatutLibelle,
    dateChangementStatut: aval.dateChangementStatut,
    nonConformites: aval.nonConformites.map((n) => ({
      dateConstat: n.dateConstat,
      type: n.type,
      gravite: n.gravite,
      description: n.description,
      actionCorrective: n.actionCorrective,
      dateResolution: n.dateResolution,
    })),
    productions: aval.productions.map((p) => ({
      numero: p.numero,
      numeroLotPate: p.numeroLotPate,
      dateProduction: p.dateProduction,
      quantiteTheorique: p.quantiteTheorique,
      // `quantiteMouvementee` et NON `quantiteReelle` (01/08/2026) : voir
      // `DonneesFicheRappelProduction.quantiteMouvementee`. La quantité
      // DÉCLARÉE porte sur l'ingrédient entier et vaut `null` dès que
      // plusieurs lots ont servi — exactement le cas qui amène un lot rappelé
      // sur cette fiche. Ce champ-ci est le seul attribuable AU LOT.
      quantiteMouvementee: p.quantiteMouvementee,
      session: p.session,
    })),
    ventes: aval.ventes.map((v) => ({
      quantite: v.quantite,
      dateMouvement: v.dateMouvement,
      session: v.session,
    })),
    garnitures: aval.garnitures.map((g) => ({
      quantite: g.quantite,
      dateMouvement: g.dateMouvement,
      session: g.session,
      produits: g.produits,
    })),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. Export Excel — etat de stock valorise
   ═══════════════════════════════════════════════════════════════════════════ */

export function donneesExportStock(base: BaseBatte, jourReference: string): DonneesExportStock {
  return {
    dateExport: new Date(),
    periodeCouverte: `Au ${jourReference}`,
    lignes: etatDuStock(base, jourReference).map((l) => ({
      ingredientNom: l.nom,
      unite: l.unite,
      quantiteDisponible: l.quantiteDisponible,
      cumpCentsParUnite: l.cumpCentsParUnite,
      valeurCents: l.valeurCents,
      stockSecurite: l.stockSecurite,
      dlcLaPlusProche: l.dlcLaPlusProche,
      nbLots: l.nbLots,
    })),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   11a. Export Excel — journal des recettes (obligatoire sous franchise TVA)
   ═══════════════════════════════════════════════════════════════════════════ */

export function donneesJournalRecettes(
  base: BaseBatte,
  annee: number,
): DonneesExportJournalRecettes {
  const debut = `${annee}-01-01`;
  const fin = finDeJournee(`${annee}-12-31`);

  const lignes = base
    .select({
      numero: schema.sessionMarche.numero,
      dateSession: schema.sessionMarche.dateSession,
      lieuNom: schema.lieuMarche.nom,
      caTotalCents: schema.sessionMarche.caTotalCents,
      caTransformeCents: schema.sessionMarche.caTransformeCents,
      caRevenduCents: schema.sessionMarche.caRevenduCents,
      caEspecesCents: schema.sessionMarche.caEspecesCents,
      caCarteCents: schema.sessionMarche.caCarteCents,
      ecartCaisseCents: schema.sessionMarche.ecartCaisseCents,
    })
    .from(schema.sessionMarche)
    .innerJoin(schema.lieuMarche, eq(schema.sessionMarche.lieuId, schema.lieuMarche.id))
    .where(
      and(
        // Seules les sessions CLOTUREES : un journal de recettes est une
        // piece comptable, pas un aperçu de la journee en cours.
        eq(schema.sessionMarche.statut, 'cloturee'),
        gte(schema.sessionMarche.dateSession, debut),
        lte(schema.sessionMarche.dateSession, fin),
      ),
    )
    .orderBy(asc(schema.sessionMarche.dateSession))
    .all();

  return { dateExport: new Date(), periodeCouverte: `Exercice ${annee}`, lignes };
}

/* ═══════════════════════════════════════════════════════════════════════════
   11b. Export Excel — journal des achats
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Journal des achats — une ligne par reception de marchandise.
 *
 * ATTENTION SI CETTE FENETRE DE DATES CHANGE : `syntheseExercice`
 * (`@batte/db`, `depots/comptabilite.ts::totalAchatsMarchandisesCents`) lit la
 * MEME table (`reception`), la MEME colonne (`montant_total_cents`) et doit
 * conserver la MEME fenetre — sans quoi ce classeur et le total « dépenses
 * déductibles » affiche sur l'ecran Comptabilite divergent de nouveau, exactement
 * le defaut mesure par docs/14-TEST-PARCOURS-UTILISATEUR.md §G2 (bénéfice brut
 * à 973,00 € pendant que ce classeur listait 447,61 € d'achats). Une
 * reconciliation est verifiee par un test (`apps/api/src/documents/journal-achats-synthese.test.ts`).
 */
export function donneesJournalAchats(base: BaseBatte, annee: number): DonneesExportJournalAchats {
  const debut = `${annee}-01-01`;
  const fin = finDeJournee(`${annee}-12-31`);

  const lignes = base
    .select({
      numero: schema.reception.numero,
      dateReception: schema.reception.dateReception,
      fournisseurNom: schema.fournisseur.nom,
      montantTotalCents: schema.reception.montantTotalCents,
      // `count` sur la jointure gauche : une reception sans lot compte 0, elle
      // ne disparait pas du journal.
      nbLots: sql<number>`count(${schema.lot.id})`,
    })
    .from(schema.reception)
    .innerJoin(schema.fournisseur, eq(schema.reception.fournisseurId, schema.fournisseur.id))
    .leftJoin(schema.lot, eq(schema.lot.receptionId, schema.reception.id))
    .where(
      and(
        gte(schema.reception.dateReception, debut),
        lte(schema.reception.dateReception, fin),
        // Réceptions ACTIVES seulement, exactement comme
        // `totalAchatsMarchandisesCents` (`depots/comptabilite.ts`) depuis le
        // 30/07/2026 — et c'est le point : ces deux lectures portent sur la même
        // table et la même fenêtre, et le docblock de cette fonction exige
        // qu'elles se réconcilient (G2). Sans ce filtre, une réception annulée
        // disparaissait de la synthèse comptable tout en restant dans le
        // classeur Excel : les deux documents auraient annoncé des achats
        // différents pour le même exercice, ce qui est exactement l'écart que G2
        // avait déjà mesuré, dans l'autre sens.
        eq(schema.reception.statut, 'active'),
      ),
    )
    .groupBy(schema.reception.id)
    .orderBy(asc(schema.reception.dateReception))
    .all();

  return { dateExport: new Date(), periodeCouverte: `Exercice ${annee}`, lignes };
}

/* ═══════════════════════════════════════════════════════════════════════════
   15. Export Excel — journal des mouvements de stock
   ═══════════════════════════════════════════════════════════════════════════ */

/** Motif lisible : le libelle structure, complete du texte libre s'il existe. */
function composerMotif(libelle: string | null, texte: string | null): string | null {
  const morceaux = [libelle, texte].filter((m): m is string => m !== null && m.trim() !== '');
  return morceaux.length === 0 ? null : morceaux.join(' — ');
}

export function donneesExportMouvements(base: BaseBatte, annee: number): DonneesExportMouvements {
  const debut = `${annee}-01-01`;
  const fin = finDeJournee(`${annee}-12-31`);

  const lignes = base
    .select({
      dateMouvement: schema.mouvementStock.dateMouvement,
      type: schema.mouvementStock.type,
      ingredientNom: schema.ingredient.nom,
      lot: schema.lot.numeroLotFournisseur,
      quantite: schema.mouvementStock.quantite,
      coutCents: schema.mouvementStock.coutCents,
      motifLibelle: schema.motif.libelle,
      motifTexte: schema.mouvementStock.motifTexte,
      isAnnule: schema.mouvementStock.isAnnule,
    })
    .from(schema.mouvementStock)
    .innerJoin(schema.ingredient, eq(schema.mouvementStock.ingredientId, schema.ingredient.id))
    .innerJoin(schema.lot, eq(schema.mouvementStock.lotId, schema.lot.id))
    .leftJoin(schema.motif, eq(schema.mouvementStock.motifId, schema.motif.id))
    .where(
      and(
        gte(schema.mouvementStock.dateMouvement, debut),
        lte(schema.mouvementStock.dateMouvement, fin),
      ),
    )
    .orderBy(asc(schema.mouvementStock.dateMouvement))
    .all();

  return {
    dateExport: new Date(),
    periodeCouverte: `Exercice ${annee}`,
    lignes: lignes.map((l) => ({
      dateMouvement: l.dateMouvement,
      // Aucun cast : l'enum du schema et `TypeMouvementExport` (`excel.ts`)
      // sont le meme jeu de valeurs, et c'est le typecheck qui le verifie.
      type: l.type,
      ingredientNom: l.ingredientNom,
      lot: l.lot,
      quantite: l.quantite,
      coutCents: l.coutCents,
      motif: composerMotif(l.motifLibelle, l.motifTexte),
      isAnnule: l.isAnnule,
    })),
  };
}
