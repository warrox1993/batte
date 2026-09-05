/**
 * Depot du referentiel modifiable : fournisseurs et produits vendus.
 *
 * Ce fichier existe parce que la lecture des fournisseurs vivait jusqu'ici dans
 * un `select` ecrit directement dans le handler Fastify. La logique de donnees
 * ne vit pas dans un handler (regle d'architecture n°1) : elle vit ici, et la
 * route se contente d'assembler et de valider.
 *
 * TROIS REGLES GOUVERNENT LES ECRITURES DE CE FICHIER.
 *
 * 1. **On bloque, on ne supprime jamais** (CLAUDE.md §3 regle 7, docs/07 §1.1).
 *    Aucun `DELETE` n'existe ici, et il ne doit jamais en apparaitre. Un
 *    fournisseur est reference par des lots recus il y a deux ans, dont la
 *    tracabilite AFSCA doit rester lisible ; un produit apparait dans des
 *    sessions cloturees, qui sont des pieces comptables conservees dix ans.
 *    Supprimer la ligne rendrait ces ecritures illisibles — c'est une
 *    obligation reglementaire, pas une elegance technique.
 *
 * 2. **La modification et sa trace d'audit sont dans la MEME transaction.**
 *    `fournisseur` et `produit_vente` sont des donnees de REFERENCE, donc
 *    modifiables, donc journalisees (docs/07 §5.2 restreint justement le
 *    journal d'audit a ces tables-la). Un journal qui survit a un echec, ou qui
 *    manque apres un succes, ment.
 *
 * 3. **Aucune validation metier ici.** La coherence nature <-> rattachement est
 *    portee par `schemaSaisieProduit` de `@batte/core`, en fonction pure et
 *    testee. Ce depot ne verifie que ce qu'un schema ne PEUT pas verifier :
 *    l'existence reelle des lignes referencees.
 */

import {
  ErreurIntrouvable,
  ErreurMetier,
  maintenantUtc,
  nouvelIdentifiant,
  type Fournisseur,
  type Produit,
  type SaisieFournisseur,
  type SaisieProduit,
} from '@batte/core';
import { asc, count, eq } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import {
  conditionnement,
  fournisseur,
  ingredient,
  produitVente,
  recette,
  recetteLigne,
} from '../schema.js';
import { journaliser } from './audit.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Fournisseurs — lecture
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Nombre de conditionnements ACTIFS par fournisseur.
 *
 * Requete separee plutot qu'une jointure agregee : un `GROUP BY` sur une
 * jointure externe compte 1 la ou il n'y a rien, et un fournisseur sans
 * conditionnement serait affiche « 1 article livre ». Le cas se produit des le
 * premier fournisseur cree depuis l'ecran.
 */
function conditionnementsParFournisseur(base: BaseBatte): Map<string, number> {
  const lignes = base
    .select({ fournisseurId: conditionnement.fournisseurId, nombre: count() })
    .from(conditionnement)
    .where(eq(conditionnement.actif, true))
    .groupBy(conditionnement.fournisseurId)
    .all();

  return new Map(lignes.map((ligne) => [ligne.fournisseurId, ligne.nombre]));
}

/**
 * Tous les fournisseurs, actifs ET inactifs, tries par nom.
 *
 * On rend volontairement TOUT : les inactifs restent lisibles parce qu'une
 * reception de 2026 les reference. C'est a l'ecran de decider ce qu'il masque,
 * et ce comportement etait deja celui de `GET /api/fournisseurs` avant cet
 * ecran — le modifier casserait les selecteurs des ecrans de reception.
 */
export function listerFournisseurs(base: BaseBatte): Fournisseur[] {
  const compteurs = conditionnementsParFournisseur(base);

  return base
    .select()
    .from(fournisseur)
    .orderBy(asc(fournisseur.nom))
    .all()
    .map((ligne) => ({
      id: ligne.id,
      nom: ligne.nom,
      type: ligne.type,
      email: ligne.email,
      telephone: ligne.telephone,
      adresse: ligne.adresse,
      delaiLivraisonJours: ligne.delaiLivraisonJours,
      francoDePortCents: ligne.francoDePortCents,
      commandeMinimumCents: ligne.commandeMinimumCents,
      notes: ligne.notes,
      actif: ligne.actif,
      nbConditionnements: compteurs.get(ligne.id) ?? 0,
    }));
}

/* ═══════════════════════════════════════════════════════════════════════════
   Fournisseurs — ecriture
   ═══════════════════════════════════════════════════════════════════════════ */

export function creerFournisseur(
  base: BaseBatte,
  saisie: SaisieFournisseur,
  parQui?: string,
): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const cree = baseTx
      .insert(fournisseur)
      .values({ id, ...saisie, actif: true, creeLe: maintenant, modifieLe: maintenant })
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'fournisseur',
      enregistrementId: id,
      action: 'creation',
      valeurApres: cree,
      parQui: parQui ?? null,
    });

    return id;
  });
}

/**
 * Refuse toute ecriture sur le fournisseur SYSTEME (« Inventaire d'ouverture »).
 *
 * DEFAUT TROUVE EN AUDIT (29/07/2026) : ni `modifierFournisseur` ni
 * `changerActiviteFournisseur` ne verifiaient `avant.type`. Consequence
 * exploitable en un seul appel `PATCH /fournisseurs/:id` : `schemaSaisieFournisseur`
 * (`contrats/referentiel.ts`) n'accepte que les QUATRE types commerciaux — un
 * `PATCH` sur l'identifiant du fournisseur systeme ecrivait donc `set({ ...saisie })`
 * et remplacait silencieusement son `type` par l'un des quatre types commerciaux.
 * Une fois ce champ bascule, TOUTES les exclusions qui reposent sur
 * `type === 'systeme'` (`conditionnementReference` de `services/commandes.ts`,
 * D-049 ; `verifierFournisseurCommercial`, definie dans
 * `depots/fournisseur-systeme.ts` et appelee par `referentiel-ecriture.ts`,
 * `depots/economies.ts`, `depots/comptabilite.ts` et `services/factures.ts`)
 * cessaient de le reconnaitre : « Inventaire d'ouverture » devenait commandable
 * comme n'importe quel meunier. C'est exactement ce que le mandat interdit —
 * « il ne peut pas etre supprime, modifie ou recevoir une commande par erreur » —
 * et la suppression et la reception etaient deja gardees, la modification ne
 * l'etait pas.
 *
 * Refuse aussi la desactivation : « Inventaire d'ouverture » n'est pas une
 * fiche commerciale qu'on retire du service, c'est une contrepartie technique
 * dont l'identite doit rester stable pour que la tracabilite amont des lots
 * anciens reste lisible.
 */
function verifierFournisseurModifiable(ligne: { id: string; type: string; nom: string }): void {
  if (ligne.type === 'systeme') {
    throw new ErreurMetier(
      'fournisseur_systeme',
      `« ${ligne.nom} » est un fournisseur système : il ne se modifie pas, ` +
        'ni ne se désactive. Sa seule fonction est de porter les lots déclarés ' +
        "avant l'installation de l'application.",
    );
  }
}

export function modifierFournisseur(
  base: BaseBatte,
  id: string,
  saisie: SaisieFournisseur,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    // Lecture AVANT la mise a jour : c'est la seule occasion de capturer l'etat
    // anterieur, l'`UPDATE` l'aura ecrase juste apres.
    const avant = baseTx.select().from(fournisseur).where(eq(fournisseur.id, id)).get();
    if (avant === undefined) throw new ErreurIntrouvable('Fournisseur', id);
    verifierFournisseurModifiable(avant);

    const apres = baseTx
      .update(fournisseur)
      .set({ ...saisie, modifieLe: maintenantUtc() })
      .where(eq(fournisseur.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'fournisseur',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}

/**
 * Active ou desactive un fournisseur. **Le remplacant de la suppression.**
 *
 * Journalise en `modification` et non en `annulation` : sur une donnee de
 * REFERENCE, `annulation` designe l'ecriture inverse d'une piece
 * transactionnelle (docs/07 §1.1, « correction : edition + trace » pour la
 * reference, « ecriture inverse » pour le transactionnel). Un blocage est un
 * changement d'etat de la fiche, pas la contrepassation d'une ecriture.
 */
export function changerActiviteFournisseur(
  base: BaseBatte,
  id: string,
  actif: boolean,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const avant = baseTx.select().from(fournisseur).where(eq(fournisseur.id, id)).get();
    if (avant === undefined) throw new ErreurIntrouvable('Fournisseur', id);
    verifierFournisseurModifiable(avant);

    const apres = baseTx
      .update(fournisseur)
      .set({ actif, modifieLe: maintenantUtc() })
      .where(eq(fournisseur.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'fournisseur',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Produits vendus — lecture
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Libelle d'une version de recette : « R1 v2 — Froment ».
 *
 * La version fait partie du libelle et n'est pas decorative : un produit pointe
 * une VERSION precise de recette (D-005), et deux versions du meme code portent
 * le meme nom. Sans le numero, deux lignes du tableau seraient indiscernables.
 */
function libelleRecette(code: string, version: number, nom: string): string {
  return `${code} v${version} — ${nom}`;
}

/**
 * Tous les produits, actifs ET inactifs, tries par nom.
 *
 * Jointures EXTERNES sur `recette` et `ingredient` : un produit transforme n'a
 * pas d'ingredient revendu et reciproquement, donc une jointure interne
 * n'aurait jamais rendu une seule ligne.
 *
 * DEPUIS LA MIGRATION 0023, `nature` peut valoir `'menu'` : un menu FIGURE
 * donc ICI, comme n'importe quel autre produit vendu — c'est la liste
 * complete du referentiel, l'ecran Produits doit pouvoir le montrer. Il s'y
 * distingue de lui-meme : `recetteId` et `ingredientId` y restent `null` (un
 * menu n'a ni l'un ni l'autre, `verifierCoherenceProduit` l'impose), ce qui
 * suffit a l'ecran pour l'afficher a part sans colonne supplementaire.
 */
export function listerProduits(base: BaseBatte): Produit[] {
  return base
    .select({
      produit: produitVente,
      recetteCode: recette.code,
      recetteVersion: recette.version,
      recetteNom: recette.nom,
      ingredientNom: ingredient.nom,
    })
    .from(produitVente)
    .leftJoin(recette, eq(produitVente.recetteId, recette.id))
    .leftJoin(ingredient, eq(produitVente.ingredientId, ingredient.id))
    .orderBy(asc(produitVente.nom))
    .all()
    .map((ligne) => ({
      id: ligne.produit.id,
      nom: ligne.produit.nom,
      nature: ligne.produit.nature,
      recetteId: ligne.produit.recetteId,
      recetteLibelle:
        ligne.recetteCode === null || ligne.recetteVersion === null || ligne.recetteNom === null
          ? null
          : libelleRecette(ligne.recetteCode, ligne.recetteVersion, ligne.recetteNom),
      ingredientId: ligne.produit.ingredientId,
      ingredientNom: ligne.ingredientNom,
      prixCents: ligne.produit.prixCents,
      consommationUnite: ligne.produit.consommationUnite,
      nbCrepes: ligne.produit.nbCrepes,
      volumeMlParUnite: ligne.produit.volumeMlParUnite,
      categorie: ligne.produit.categorie,
      consommationSurPlace: ligne.produit.consommationSurPlace,
      actif: ligne.produit.actif,
    }));
}

/* ═══════════════════════════════════════════════════════════════════════════
   Produits vendus — ecriture
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Verifie que les lignes referencees existent REELLEMENT.
 *
 * C'est la seule chose qu'un schema Zod ne peut pas verifier : il valide une
 * forme, pas l'etat de la base. Sans ce controle, une cle etrangere inconnue
 * remonterait en contrainte SQLite brute, donc en 500 « erreur inattendue »,
 * alors que c'est une faute de saisie qui merite un 422 designant le champ
 * (D-035).
 */
function verifierRattachements(base: BaseBatte, saisie: SaisieProduit): void {
  if (saisie.recetteId !== null) {
    const existe = base
      .select({ id: recette.id })
      .from(recette)
      .where(eq(recette.id, saisie.recetteId))
      .get();
    if (existe === undefined) {
      throw new ErreurMetier('recette_introuvable', "La recette choisie n'existe plus.", {
        champs: { recetteId: 'Choisissez une recette existante.' },
      });
    }
  }

  if (saisie.ingredientId !== null) {
    const existe = base
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(eq(ingredient.id, saisie.ingredientId))
      .get();
    if (existe === undefined) {
      throw new ErreurMetier('ingredient_introuvable', "L'article revendu choisi n'existe plus.", {
        champs: { ingredientId: 'Choisissez un article existant.' },
      });
    }
  }
}

/** Diagnostic d'une recette, restreint à ce qu'a besoin `diagnostiquerRecettePourCoutNul`. */
export type DiagnosticRecetteCoutNul = {
  readonly libelle: string;
  readonly statut: 'brouillon' | 'active' | 'archivee';
  readonly nbLignes: number;
};

/**
 * Diagnostic d'UNE recette, pour EXPLIQUER (jamais empêcher) un coût matière
 * transformé nul constaté à la clôture d'une session
 * (`services/sessions.ts::cloturerSession`, `coutMatiereTransformeSuspect` de
 * `@batte/core`).
 *
 * `verifierRattachements` ci-dessus ne vérifie QUE l'existence de la recette,
 * au moment où un produit la référence (création ou modification) — jamais
 * son statut ni son nombre de lignes, et elle n'a PAS à le faire : un produit
 * adossé à une recette encore en brouillon, ou pas encore garnie d'une seule
 * ligne, est un ORDRE DE TRAVAIL normal (« la recette n'est pas encore finie »),
 * pas une faute à la création. C'est au moment de la VENTE que l'incohérence
 * devient une anomalie qui mérite d'être vue (CLAUDE.md §7 : « avertir, pas
 * interdire »), pas à celui de la création du produit — voir le rapport de
 * livraison pour pourquoi ce choix se limite à la clôture dans ce lot.
 *
 * Fonction de LECTURE SEULE, jamais appelée sur le chemin d'écriture d'un
 * produit : elle ne bloque et ne journalise rien, elle sert uniquement à
 * enrichir un message d'avertissement déjà déclenché ailleurs (le
 * déclenchement lui-même est `coutMatiereTransformeSuspect`, une fonction PURE
 * de `@batte/core` — cette fonction-ci ne fait qu'aller lire, en base,
 * pourquoi une recette précise pourrait expliquer le zéro constaté).
 *
 * `null` si la recette n'existe plus : cas déjà couvert ailleurs
 * (`verifierRattachements`), jamais atteint ici en pratique puisqu'un produit
 * ne référence qu'une recette qui existait au moment où il a été créé — mais
 * une recette de référence n'est jamais supprimée (CLAUDE.md §3 règle 7), donc
 * ce cas ne peut de toute façon pas survenir en dehors d'un bug ailleurs.
 */
export function diagnostiquerRecettePourCoutNul(
  base: BaseBatte,
  recetteId: string,
): DiagnosticRecetteCoutNul | null {
  const ligne = base
    .select({
      code: recette.code,
      version: recette.version,
      nom: recette.nom,
      statut: recette.statut,
    })
    .from(recette)
    .where(eq(recette.id, recetteId))
    .get();
  if (ligne === undefined) return null;

  const compte = base
    .select({ nombre: count() })
    .from(recetteLigne)
    .where(eq(recetteLigne.recetteId, recetteId))
    .get();

  return {
    libelle: libelleRecette(ligne.code, ligne.version, ligne.nom),
    statut: ligne.statut,
    nbLignes: compte?.nombre ?? 0,
  };
}

export function creerProduit(base: BaseBatte, saisie: SaisieProduit, parQui?: string): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;
    verifierRattachements(baseTx, saisie);

    const cree = baseTx
      .insert(produitVente)
      .values({ id, ...saisie, actif: true, creeLe: maintenant, modifieLe: maintenant })
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'produit_vente',
      enregistrementId: id,
      action: 'creation',
      valeurApres: cree,
      parQui: parQui ?? null,
    });

    return id;
  });
}

export function modifierProduit(
  base: BaseBatte,
  id: string,
  saisie: SaisieProduit,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const avant = baseTx.select().from(produitVente).where(eq(produitVente.id, id)).get();
    if (avant === undefined) throw new ErreurIntrouvable('Produit', id);

    verifierRattachements(baseTx, saisie);

    const apres = baseTx
      .update(produitVente)
      .set({ ...saisie, modifieLe: maintenantUtc() })
      .where(eq(produitVente.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'produit_vente',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}

/**
 * Retire un produit de la vente, ou l'y remet. **Le remplacant de la
 * suppression** : ce produit figure dans des sessions cloturees, qui sont des
 * pieces comptables. Voir `changerActiviteFournisseur` pour le choix du code
 * d'action journalise.
 */
export function changerActiviteProduit(
  base: BaseBatte,
  id: string,
  actif: boolean,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    const avant = baseTx.select().from(produitVente).where(eq(produitVente.id, id)).get();
    if (avant === undefined) throw new ErreurIntrouvable('Produit', id);

    const apres = baseTx
      .update(produitVente)
      .set({ actif, modifieLe: maintenantUtc() })
      .where(eq(produitVente.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'produit_vente',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}
