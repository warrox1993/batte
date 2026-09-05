/**
 * Contrat HTTP du referentiel modifiable : fournisseurs et produits vendus
 * (docs/06 — conventions d'API).
 *
 * Le meme schema valide la sortie cote serveur et derive le type cote client :
 * les deux cotes ne peuvent pas diverger en silence.
 *
 * CE FICHIER PORTE UNE REGLE METIER, ET C'EST VOULU. La coherence
 * nature <-> rattachement d'un produit (§ « saisie d'un produit » plus bas) est
 * une regle, pas une contrainte de transport. Elle vit ici pour trois raisons :
 *
 *  1. elle est PURE et testee (regle d'architecture n°1) — aucun acces base,
 *     aucun effet de bord ;
 *  2. elle s'applique aux DEUX frontieres avec le meme code : le navigateur
 *     l'utilise pour afficher l'erreur sous le champ avant tout aller-retour,
 *     le serveur la rejoue pour ne jamais faire confiance au client ;
 *  3. exprimee en `superRefine` avec un `path`, elle produit automatiquement un
 *     422 accompagne de `champs` (D-035), sans une ligne de code dans le
 *     gestionnaire Fastify.
 *
 * Une regle ecrite deux fois se contredit un jour. Elle est ecrite une fois.
 */

import { z } from 'zod';
import { estJourCivilValide } from '../horodatage.js';
import type { ChampsEnErreur } from '../erreurs.js';
import { schemaStatutRecette, schemaUnite } from './recettes.js';

/**
 * Traduit les issues d'un `ZodError` en `champs` (nom du champ -> message).
 *
 * POURQUOI CETTE FONCTION EXISTE ET POURQUOI ELLE EST ICI. Le gestionnaire
 * d'erreurs Fastify fait deja exactement cette traduction pour produire un 422
 * avec `champs` (D-035). Le NAVIGATEUR en a besoin pour la meme raison : les
 * schemas de ce fichier sont partages, donc un formulaire peut refuser une
 * densite non finie ou une nature incoherente **avant** tout aller-retour, avec
 * le message exact que le serveur donnerait — et l'accrocher sous le bon champ.
 *
 * Ecrire ce mapping une fois par ecran garantirait qu'ils divergent : trois
 * ecrans, trois facons d'aplatir `path`, et un jour un chemin de ligne
 * (`lignes.2.quantiteUniteRef`) qu'un des trois ne saurait plus retrouver.
 *
 * `_global` pour une issue qui ne vise aucun champ : meme convention que le
 * serveur, sinon un message sans `path` disparaitrait sans laisser de trace.
 */
export function champsDepuisErreurZod(erreur: z.ZodError): ChampsEnErreur {
  const champs: ChampsEnErreur = {};
  for (const issue of erreur.issues) {
    const chemin = issue.path.length === 0 ? '_global' : issue.path.join('.');
    champs[chemin] = issue.message;
  }
  return champs;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Champs de formulaire communs
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Un champ texte vide d'un formulaire HTML arrive en `''`, jamais en `null`.
 * Sans cette normalisation, la base stockerait des chaines vides a cote de
 * `NULL` pour dire la meme chose — et `email IS NULL` cesserait de repondre a
 * « quels fournisseurs ne peuvent pas recevoir de bon de commande ? ».
 */
function normaliserTexte(valeur: string | null | undefined): string | null {
  if (valeur === undefined || valeur === null) return null;
  const nettoye = valeur.trim();
  return nettoye === '' ? null : nettoye;
}

const champTexteFacultatif = z.string().nullish().transform(normaliserTexte);

/**
 * Adresse e-mail facultative, mais valide si elle est renseignee.
 *
 * Un e-mail absent est un cas metier normal (la ferme ou l'on passe prendre les
 * oeufs n'en a pas). Un e-mail FAUX est un piege : le bon de commande part dans
 * le vide et l'utilisateur croit avoir commande.
 */
const champEmailFacultatif = champTexteFacultatif.refine(
  (valeur) => valeur === null || z.email().safeParse(valeur).success,
  { message: 'Adresse e-mail invalide. Exemple attendu : contact@moulin.be' },
);

/** Montant facultatif, en centimes entiers (CLAUDE.md §3 : jamais de flottant). */
const champCentimesFacultatif = z
  .int('Ce montant doit être un nombre entier de centimes.')
  .nonnegative('Ce montant ne peut pas être négatif.')
  .nullish()
  .transform((valeur) => valeur ?? null);

/* ═══════════════════════════════════════════════════════════════════════════
   Fournisseurs
   ═══════════════════════════════════════════════════════════════════════════ */

/** Les quatre natures COMMERCIALES : celles chez qui on passe commande. */
export const schemaTypeFournisseurCommercial = z.enum(['moulin', 'grossiste', 'ferme', 'detail']);

/**
 * Types lisibles depuis l'API — les quatre commerciaux, plus `systeme`.
 *
 * `systeme` désigne une contrepartie qui n'est pas un fournisseur : aujourd'hui
 * le seul cas est « Inventaire d'ouverture », qui porte le stock présent avant
 * l'installation de l'application. Il faut bien une contrepartie nommée — un
 * `fournisseurId` nul répondrait « on ne sait pas » à la question « d'où vient
 * ce lot ? », qui est précisément celle posée lors d'un rappel AFSCA.
 *
 * **Il est lisible mais PAS saisissable** : `schemaSaisieFournisseur` n'accepte
 * que les quatre types commerciaux. Sans cette séparation, un formulaire
 * pourrait fabriquer un faux fournisseur système, et donc du stock d'origine
 * non tracée à volonté.
 */
export const schemaTypeFournisseur = z.enum(['moulin', 'grossiste', 'ferme', 'detail', 'systeme']);

/**
 * Fournisseur tel qu'il sort de l'API.
 *
 * Les champs `id`, `nom`, `type`, `delaiLivraisonJours` et `actif` etaient deja
 * exposes par `GET /api/fournisseurs` avant cet ecran : ils sont conserves a
 * l'identique. Les suivants sont AJOUTES — jamais un champ retire ni renomme,
 * sous peine de casser les selecteurs des ecrans de reception et d'achats.
 */
export const schemaFournisseur = z.object({
  id: z.string(),
  nom: z.string(),
  type: schemaTypeFournisseur,
  email: z.string().nullable(),
  telephone: z.string().nullable(),
  adresse: z.string().nullable(),
  delaiLivraisonJours: z.int(),
  francoDePortCents: z.int().nullable(),
  commandeMinimumCents: z.int().nullable(),
  notes: z.string().nullable(),
  actif: z.boolean(),
  /**
   * Nombre de conditionnements ACTIFS rattaches. C'est la reponse a « qu'est-ce
   * que ce fournisseur me livre ? », et surtout l'indicateur qui dit qu'une
   * desactivation va vider des lignes de commande.
   */
  nbConditionnements: z.int(),
});

export const schemaListeFournisseurs = z.object({
  data: z.array(schemaFournisseur),
  meta: z.object({ total: z.int() }),
});

/**
 * Borne haute du delai de livraison. Ce n'est PAS un seuil reglementaire (ceux-la
 * vivent dans la table `parametre`, CLAUDE.md §7) : c'est un garde-fou de saisie.
 * Le delai alimente le point de commande (`conso x delai + stock de securite`),
 * donc un « 3650 » tape pour « 365 » gonflerait silencieusement toutes les
 * quantites commandees.
 */
const DELAI_LIVRAISON_MAX_JOURS = 365;

export const schemaSaisieFournisseur = z.object({
  nom: z.string().trim().min(1, 'Le nom du fournisseur est obligatoire.'),
  // COMMERCIAL uniquement : on ne fabrique pas un fournisseur système depuis un
  // formulaire, sinon on fabrique du stock d'origine non tracée à volonté.
  type: schemaTypeFournisseurCommercial,
  email: champEmailFacultatif,
  telephone: champTexteFacultatif,
  adresse: champTexteFacultatif,
  delaiLivraisonJours: z
    .int('Le délai de livraison doit être un nombre entier de jours.')
    .nonnegative('Le délai de livraison ne peut pas être négatif.')
    .max(
      DELAI_LIVRAISON_MAX_JOURS,
      `Le délai de livraison doit tenir dans ${DELAI_LIVRAISON_MAX_JOURS} jours. Au-delà, c'est presque toujours une faute de frappe.`,
    ),
  francoDePortCents: champCentimesFacultatif,
  commandeMinimumCents: champCentimesFacultatif,
  notes: champTexteFacultatif,
});

/* ═══════════════════════════════════════════════════════════════════════════
   Produits vendus
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Trois natures : les deux VENDUES (`transforme`, `revendu`), plus `menu`
 * (fiche 16 §2) — un produit fait d'autres produits, dont le coût vient de
 * ses composants et non d'une recette ou d'un article propre.
 *
 * `menu` valide la FORME d'un `produit_vente` : c'est la troisième valeur que
 * la colonne autorise réellement (migration 0023), donc celle que ce schéma
 * doit accepter pour ne jamais rejeter une ligne que la base contient déjà.
 * Elle N'EST PAS reprise dans `NatureProduit` de `packages/core/src/sessions.ts`
 * (volontairement limité aux deux natures VENDUES) : une ligne qui atteint
 * `totaliserVentes`, et donc les compteurs de seuils légaux, est TOUJOURS
 * `transforme` ou `revendu`, jamais `menu` — un menu y est explosé en ses
 * composants avant (`exploserVenteMenuEnLignesVente`, `packages/core/src/
 * menus.ts`). Les deux types divergent donc DÉLIBÉRÉMENT : ne pas les
 * fusionner sous prétexte qu'ils se ressemblent.
 */
export const schemaNatureProduit = z.enum(['transforme', 'revendu', 'menu']);

/**
 * Ce qu'UNE unité vendue consomme DE LA PRODUCTION. Trois réponses possibles,
 * et elles s'excluent — voir le commentaire complet sur la colonne
 * `produit_vente.consommation_unite` (`packages/db/src/schema.ts`, décision du
 * porteur du 31/07/2026) pour le défaut que ce champ corrige : `nb_crepes = 0`
 * portait deux sens à la fois (« c'est de la pâte » et « ce produit ne
 * consomme aucune crêpe »), et la validation ne pouvait pas les distinguer.
 *
 * `null` pour `revendu` et `menu` : la question ne se pose pas — un revendu ne
 * consomme rien de la production, un menu n'en consomme rien lui-même (ce
 * sont ses composants qui en consomment, chacun selon sa propre nature).
 */
export const schemaConsommationUnite = z.enum(['crepes', 'volume_pate', 'nomenclature']);
export type ConsommationUnite = z.infer<typeof schemaConsommationUnite>;

/**
 * Type complet, conteneur de menu compris — dérivé du schéma ci-dessus, donc
 * jamais en désaccord avec la forme réellement validée. À utiliser partout où
 * une ligne peut désigner un CONTENEUR (listes de produits, dépôt des menus) ;
 * jamais là où la ligne doit avoir déjà été ramenée aux deux natures vendues
 * (voir `NatureProduit`, `packages/core/src/sessions.ts`).
 */
export type NatureProduitVente = z.infer<typeof schemaNatureProduit>;

/**
 * Produit tel qu'il sort de l'API, enrichi du LIBELLE de ce a quoi il est
 * rattache.
 *
 * Le libelle accompagne toujours l'identifiant : un tableau qui n'affiche
 * qu'un UUID oblige a ouvrir la fiche pour savoir de quelle recette on parle.
 */
export const schemaProduit = z.object({
  id: z.string(),
  nom: z.string(),
  nature: schemaNatureProduit,
  /** Renseigne si et seulement si `nature === 'transforme'`. */
  recetteId: z.string().nullable(),
  recetteLibelle: z.string().nullable(),
  /** Renseigne si et seulement si `nature === 'revendu'`. */
  ingredientId: z.string().nullable(),
  ingredientNom: z.string().nullable(),
  prixCents: z.int(),
  /**
   * Ce qu'UNE unite vendue consomme de la production — voir
   * `schemaConsommationUnite` ci-dessus. `null` pour `revendu` et `menu` : la
   * question ne se pose pas.
   */
  consommationUnite: schemaConsommationUnite.nullable(),
  nbCrepes: z.int().nullable(),
  /**
   * Volume de pate qu'une unite representre, en ml — la PATE VENDUE TELLE
   * QUELLE (`consommationUnite === 'volume_pate'`).
   *
   * Expose ici parce que sans lui, reouvrir une fiche de pate vendue affichait
   * un champ VIDE : l'ecran ne pouvait pas pre-remplir ce qu'il ne recevait
   * pas. L'echec etait sur : la regle Zod du serveur refusait l'enregistrement
   * en 422 plutot que d'ecraser la valeur stockee — mais le porteur ne pouvait
   * pas modifier un tel produit sans resaisir son volume.
   */
  volumeMlParUnite: z.int().nullable(),
  categorie: z.string().nullable(),
  consommationSurPlace: z.boolean(),
  actif: z.boolean(),
});

export const schemaListeProduits = z.object({
  data: z.array(schemaProduit),
  meta: z.object({ total: z.int() }),
});

/** Forme brute de la saisie d'un produit, avant application des regles de coherence. */
const schemaSaisieProduitBrute = z.object({
  nom: z.string().trim().min(1, 'Le nom du produit est obligatoire.'),
  nature: schemaNatureProduit,
  recetteId: champTexteFacultatif,
  ingredientId: champTexteFacultatif,
  prixCents: z
    .int('Le prix de vente doit être un nombre entier de centimes.')
    .nonnegative('Le prix de vente ne peut pas être négatif.'),
  /**
   * Ce qu'UNE unité vendue consomme de la production — voir
   * `schemaConsommationUnite`. Exigé (l'un des trois) sur un `transforme`,
   * refusé sur un `revendu`/`menu` (voir `verifierConsommationUniteTransforme`
   * et `verifierCoherenceProduit`) : « sans objet » n'est PAS « à renseigner »
   * — un revendu ne consomme rien de la production, la question ne se pose
   * pas, l'appelant ne doit pas avoir à y répondre par un `null` explicite.
   *
   * `.nullable().exactOptional()`, PAS `.nullish().transform(() => null)` :
   * sous `exactOptionalPropertyTypes` (actif, `tsconfig.base.json`), la
   * seconde forme aurait rendu la clé OBLIGATOIRE dans le type inféré (une
   * valeur systématiquement présente, fût-elle `null`) — donc chaque fixture
   * qui crée un `revendu` ou un `menu` aurait dû écrire explicitement
   * `consommationUnite: null` pour une question qui ne la concerne pas.
   * `.exactOptional()` garde la clé OMETTABLE (même patron que
   * `schemaSaisieCompositionMenu.prixForceCents`, `packages/core/src/contrats/
   * menus.ts`) : un `revendu`/`menu` qui ne la fournit pas reste valide, et la
   * fournir quand même (à `null` ou à une vraie valeur) est refusé
   * explicitement par `verifierCoherenceProduit` — jamais silencieusement
   * ignoré.
   */
  consommationUnite: schemaConsommationUnite.nullable().exactOptional(),
  /**
   * `0` reste une valeur EXPLICITE (« cette unité ne produit aucune crêpe »),
   * jamais une absence — mais ce n'est PLUS elle qui distingue la pâte vendue
   * au volume d'un transformé à la demande (fiche 15 §4) : c'est
   * `consommationUnite` qui le fait (voir `verifierConsommationUniteTransforme`
   * ci-dessous). `null` reste refusé sur un transformé qui consomme
   * réellement des crêpes, parce qu'on ne saurait alors pas quoi en déduire.
   */
  nbCrepes: z
    .int('Le nombre de crêpes doit être un nombre entier.')
    .nonnegative('Le nombre de crêpes ne peut pas être négatif.')
    .nullish()
    .transform((valeur) => valeur ?? null),
  /**
   * Volume de pâte que représente une unité vendue, en ml. Obligatoire dès que
   * `consommationUnite === 'volume_pate'` : sans lui, la clôture au volume ne
   * saurait pas combien retrancher, et la bouteille redeviendrait de fausses
   * crêpes.
   */
  volumeMlParUnite: z
    .int('Le volume doit être un nombre entier de millilitres.')
    .positive('Une unité de pâte vendue représente un volume strictement positif.')
    .nullish()
    .transform((valeur) => valeur ?? null)
    .default(null),
  categorie: champTexteFacultatif,
  consommationSurPlace: z.boolean(),
});

/** Saisie d'un produit, telle qu'elle arrive du formulaire — avant les regles. */
export type SaisieProduitBrute = z.infer<typeof schemaSaisieProduitBrute>;

/**
 * Cohérence entre `consommationUnite` et les DEUX champs qui portent la
 * VALEUR (`nbCrepes`, `volumeMlParUnite`) — UNIQUEMENT sur un `transforme` :
 * c'est la seule nature où la question « qu'est-ce qu'une unité vendue
 * consomme de la production ? » se pose (fiche 15 §4 et §5.1).
 *
 * RENDRE LES ÉTATS IMPOSSIBLES INÉCRIVABLES, cas par cas :
 *
 *  - `crepes` (une crêpe garnie) : `nbCrepes` doit être renseigné, au moins 1
 *    — sans lui, le taux d'écoulement de la session est incalculable.
 *    `volumeMlParUnite` doit rester `null` : un produit compté en crêpes n'a
 *    pas de volume par unité, ce champ ne décrit qu'une bouteille.
 *  - `volume_pate` (de la pâte vendue telle quelle, fiche 15 §5.1) :
 *    `volumeMlParUnite` doit être renseigné et positif — sans lui, la clôture
 *    au volume ne saurait pas combien retrancher du bac, et la bouteille
 *    redeviendrait de fausses crêpes. `nbCrepes` doit valoir EXACTEMENT `0` :
 *    c'est la même valeur EXPLICITE qu'avant cette refonte (« cette unité ne
 *    produit aucune crêpe »), mais elle n'est plus le signal qui identifie ce
 *    cas — `consommationUnite` l'est désormais. Un `volume_pate` à 5 crêpes
 *    (ou à `null`) est refusé : une unité ne peut pas être à la fois une
 *    bouteille et une crêpe, et laisser passer `null` ferait retomber le
 *    calcul aval (`nbCrepesParUnite`, `packages/db/src/services/sessions.ts`)
 *    sur son défaut `?? 1` — une bouteille compterait alors comme une crêpe
 *    produite.
 *  - `nomenclature` (rien de la production, sa composition vit dans
 *    `produit_vente_composant` — le café, fait à la tasse et non par fournée,
 *    fiche 15 §4) : NI `nbCrepes` NI `volumeMlParUnite` n'est EXIGÉ par
 *    l'écran. Mais, pour la même raison que `volume_pate` ci-dessus,
 *    `nbCrepes` doit rester à `0` (jamais `null`, jamais un autre nombre) —
 *    c'est la même valeur « aucune crêpe produite », pour une raison
 *    DIFFÉRENTE (fiche 15 §4 contre §5.1) — et `volumeMlParUnite` doit rester
 *    `null` (ce produit ne représente aucun volume de pâte). C'est CE défaut
 *    précis qui bloquait le café avant cette refonte : `nbCrepes === 0`
 *    signifiait à la fois « pâte » et « ne consomme aucune crêpe », et la
 *    validation exigeait alors à tort un `volumeMlParUnite` pour un café.
 *
 * LE DÉFAUT QUE CE CHAMP CORRIGE (verifié, ce n'est plus une simple lecture
 * de code) : donner 100 ml au café — l'eau de la tasse — aurait fait
 * RETRANCHER 100 ml du bac de pâte à chaque café vendu (`estPateVendueAuVolume`,
 * `packages/core/src/sessions.ts`, qui ne lit plus que `consommationUnite`).
 * Pire que le blocage qu'il remplaçait.
 */
function verifierConsommationUniteTransforme(
  saisie: SaisieProduitBrute,
  ctx: z.RefinementCtx,
): void {
  // La clé est OMETTABLE (`.exactOptional()`) : une saisie qui ne la fournit
  // pas du tout (`undefined`) équivaut à « pas encore choisi », exactement
  // comme si elle valait `null` explicitement. Normalisée une seule fois ici.
  const consommationUnite = saisie.consommationUnite ?? null;

  if (consommationUnite === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['consommationUnite'],
      message:
        "Précisez ce qu'une unité vendue consomme : des crêpes, un volume de pâte, ou rien de " +
        'la production (sa composition vit alors dans la nomenclature de vente — le café, par ' +
        'exemple, qui se fait à la tasse et non par fournée).',
    });
    return;
  }

  if (consommationUnite === 'crepes') {
    if (saisie.nbCrepes === null || saisie.nbCrepes < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['nbCrepes'],
        message:
          'Indiquez combien de crêpes une unité vendue consomme : au moins 1. Sans ce nombre, ' +
          "le taux d'écoulement de la session est incalculable.",
      });
    }
    if (saisie.volumeMlParUnite !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['volumeMlParUnite'],
        message:
          "Un produit compté en crêpes n'a pas de volume par unité : ce champ ne décrit qu'une " +
          'bouteille de pâte vendue telle quelle. Laissez-le vide.',
      });
    }
    return;
  }

  if (consommationUnite === 'volume_pate') {
    if (saisie.volumeMlParUnite === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['volumeMlParUnite'],
        message:
          'De la pâte vendue au volume doit indiquer le volume que représente une unité : sans ' +
          'lui, la clôture au volume ne saurait pas combien retrancher du bac.',
      });
    }
    if (saisie.nbCrepes !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['nbCrepes'],
        message:
          'De la pâte vendue au volume ne produit aucune crêpe : ce champ doit valoir 0. Une ' +
          'unité ne peut pas être à la fois une bouteille et une crêpe.',
      });
    }
    return;
  }

  // 'nomenclature' : ni nbCrepes ni volumeMlParUnite n'est EXIGÉ par l'écran
  // — mais les deux doivent rester à leur valeur neutre (voir l'en-tête
  // ci-dessus) pour ne jamais faire retomber le calcul aval sur un défaut
  // inventé, et pour ne jamais laisser croire à un volume de pâte que ce
  // produit ne représente pas.
  if (saisie.nbCrepes !== 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['nbCrepes'],
      message:
        'Un produit dont la composition vient de la nomenclature de vente ne consomme aucune ' +
        'crêpe lui-même : ce champ doit valoir 0.',
    });
  }
  if (saisie.volumeMlParUnite !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['volumeMlParUnite'],
      message:
        'Un produit dont la composition vient de la nomenclature de vente ne représente aucun ' +
        "volume de pâte : ce champ ne décrit qu'une bouteille vendue telle quelle. Laissez-le vide.",
    });
  }
}

/**
 * LA regle metier de cet ecran : la nature d'un produit commande son
 * rattachement, et rien d'autre.
 *
 * POURQUOI C'EST STRUCTURANT, ET PAS UN DETAIL D'AFFICHAGE. Un transforme sort
 * de la pate et des garnitures ; un revendu sort une unite de stock achetee
 * preemballee. Les deux mecaniques de stock, les deux marges (~90 % contre
 * ~30-40 %) et les deux regimes AFSCA different. Surtout : a marge egale, la
 * revente genere environ 2,6 fois plus de CHIFFRE D'AFFAIRES — et les seuils
 * legaux belges portent sur le CA, pas sur la marge (CLAUDE.md §6). Un pot de
 * sirop enregistre par erreur en « transforme » fausse donc la ventilation des
 * compteurs de seuils, et l'utilisateur sort de la franchise TVA sans l'avoir
 * vu venir.
 *
 * Chaque `addIssue` porte un `path` : le gestionnaire d'erreurs de l'API le
 * transforme en `champs.<nom>`, donc en message affiche SOUS le champ fautif
 * (docs/07 §4.7), et non en banniere generique.
 */
export function verifierCoherenceProduit(saisie: SaisieProduitBrute, ctx: z.RefinementCtx): void {
  if (saisie.nature === 'transforme') {
    if (saisie.recetteId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['recetteId'],
        message:
          "Un produit transformé doit être rattaché à une recette : c'est elle qui décrit ce qui sort du stock à la production.",
      });
    }
    if (saisie.ingredientId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['ingredientId'],
        message:
          'Un produit transformé ne se rattache pas à un article revendu : il est fabriqué, pas acheté tel quel.',
      });
    }

    verifierConsommationUniteTransforme(saisie, ctx);
    return;
  }

  if (saisie.nature === 'menu') {
    // Fiche 16 §2 : un menu (« crêpe + café ») n'a NI recette ni article
    // propre — son coût de revient vient de la SOMME de ses composants
    // (`ventilerMenu`, `packages/core/src/menus.ts`), calculée à la lecture,
    // jamais stockée ici. Lui laisser une fausse recette ou un faux article
    // donnerait un coût de revient TROMPEUR à côté du vrai coût des
    // composants — exactement l'erreur que cette règle existe pour éviter.
    if (saisie.recetteId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['recetteId'],
        message:
          "Un menu n'a pas de recette propre : son coût vient de la somme de ses composants, pas d'une recette qui lui serait rattachée.",
      });
    }
    if (saisie.ingredientId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['ingredientId'],
        message:
          "Un menu n'est pas acheté préemballé : il ne se rattache pas à un article revendu.",
      });
    }
    if (saisie.nbCrepes !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['nbCrepes'],
        message:
          'Un menu ne consomme pas de crêpes lui-même : ce sont ses composants qui en consomment, chacun selon sa propre nature. Laissez ce champ vide.',
      });
    }
    /*
     * COMMENTAIRE CORRIGÉ le 01/08/2026. Il affirmait que l'envoyer « même à
     * `null` » était attrapé par ce refus. C'était FAUX — la condition exclut
     * `null` — et c'est le CODE qui a raison, vérifié côté appelant :
     * `corpsSaisieProduit` (`apps/web/src/pages/Produits.tsx`) envoie
     * `consommationUnite: null` pour TOUT produit non transformé. Durcir ici
     * aurait cassé l'enregistrement de chaque menu et de chaque revendu.
     *
     * Pourquoi ce n'est pas incohérent avec `nbCrepes: 0`, refusé quelques
     * lignes plus haut : `0` est une VALEUR légitime de `nbCrepes` (un
     * transformé à la demande, le café, en porte une) — la refuser sur un menu,
     * c'est refuser une réponse qui a du sens à une question qui n'en a pas.
     * `null`, lui, n'est pas une valeur de `consommationUnite` : c'est
     * l'absence de réponse, épelée par un formulaire HTML qui ne sait pas
     * omettre une clé. Refuser l'un et accepter l'autre est le bon tri.
     */
    if (saisie.consommationUnite !== undefined && saisie.consommationUnite !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['consommationUnite'],
        message:
          'Un menu ne consomme rien lui-même de la production : ce sont ses composants qui en consomment, chacun selon sa propre nature. Laissez ce champ vide.',
      });
    }
    return;
  }

  if (saisie.ingredientId === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['ingredientId'],
      message:
        "Un produit revendu doit désigner l'article acheté préemballé dont il sort une unité de stock.",
    });
  }
  if (saisie.recetteId !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['recetteId'],
      message:
        "Un produit revendu n'a pas de recette : il est acheté préemballé et revendu tel quel.",
    });
  }
  if (saisie.nbCrepes !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['nbCrepes'],
      message: 'Un produit revendu ne consomme aucune crêpe : laissez ce champ vide.',
    });
  }
  // Même correction que pour le menu ci-dessus (01/08/2026) : `null` est
  // ACCEPTÉ, parce que l'écran l'envoie pour tout produit non transformé et
  // qu'il vaut « pas de réponse », pas « réponse nulle ». Seule une unité
  // réelle (`crepes`, `volume_pate`, `nomenclature`) est refusée ici.
  if (saisie.consommationUnite !== undefined && saisie.consommationUnite !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['consommationUnite'],
      message:
        'Un produit revendu ne consomme rien de la production : il sort directement une unité de stock. Laissez ce champ vide.',
    });
  }
}

export const schemaSaisieProduit = schemaSaisieProduitBrute.superRefine(verifierCoherenceProduit);

/* ═══════════════════════════════════════════════════════════════════════════
   Ingredients (lecture)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Ingredient tel qu'expose par `GET /api/ingredients`.
 *
 * Ce schema decrivait la sortie de la route dans le fichier de route lui-meme.
 * Il est remonte ici pour que le client en DERIVE son type au lieu de le
 * reecrire a la main : c'est la regle de docs/06 (« le typage du client est
 * derive du schema, jamais reecrit »), et l'ecran Produits en a besoin pour
 * garnir la liste des articles revendus.
 */
export const schemaIngredientReferentiel = z.object({
  id: z.string(),
  nom: z.string(),
  categorie: z.string(),
  unite: schemaUnite,
  densiteGParMl: z.number().nullable(),
  allergenes: z.array(z.string()),
  /**
   * Distingue « vérifié, aucun allergène » de « jamais évalué ». Tant que ce
   * drapeau est faux, `allergenes` vide ne veut RIEN dire de sûr : c'est la
   * doctrine « une valeur inconnue ne vaut pas zéro » (CLAUDE.md) appliquée à
   * la sécurité alimentaire. Voir le commentaire complet sur la colonne,
   * `packages/db/src/schema.ts`.
   */
  allergenesVerifies: z.boolean(),
  stockSecurite: z.int(),
  dureeConservationJours: z.int().nullable(),
});

export const schemaListeIngredients = z.object({
  data: z.array(schemaIngredientReferentiel),
  meta: z.object({ total: z.int() }),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Activation / desactivation
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * On BLOQUE, on ne supprime jamais (CLAUDE.md §3 regle 7, docs/07 §1.1).
 *
 * Un fournisseur est reference par des lots recus il y a deux ans, dont la
 * tracabilite AFSCA doit rester lisible ; un produit apparait dans des sessions
 * cloturees, qui sont des pieces comptables que le droit belge impose de
 * pouvoir relire pendant dix ans. Supprimer la ligne rendrait ces ecritures
 * illisibles. Un partenaire qu'on ne frequente plus se DESACTIVE : il disparait
 * des listes de choix, il reste dans l'historique.
 */
export const schemaChangementActivite = z.object({ actif: z.boolean() });

export type TypeFournisseur = z.infer<typeof schemaTypeFournisseur>;
export type TypeFournisseurCommercial = z.infer<typeof schemaTypeFournisseurCommercial>;
export type Fournisseur = z.infer<typeof schemaFournisseur>;
export type ListeFournisseurs = z.infer<typeof schemaListeFournisseurs>;
export type SaisieFournisseur = z.infer<typeof schemaSaisieFournisseur>;
/**
 * PAS de `export type NatureProduit` ici : `packages/core/src/sessions.ts` en
 * exporte deja un, strictement identique (`'transforme' | 'revendu'`). Deux
 * alias du meme nom dans le meme barrel rendent l'export ambigu et cassent la
 * compilation — et surtout, deux definitions de la meme notion finissent par
 * diverger. `schemaNatureProduit` ci-dessus reste la source de VALIDATION ;
 * le type, lui, se prend dans `sessions.ts`.
 */
export type Produit = z.infer<typeof schemaProduit>;
export type ListeProduits = z.infer<typeof schemaListeProduits>;
export type SaisieProduit = z.infer<typeof schemaSaisieProduit>;
export type IngredientReferentiel = z.infer<typeof schemaIngredientReferentiel>;
export type ListeIngredients = z.infer<typeof schemaListeIngredients>;
export type ChangementActivite = z.infer<typeof schemaChangementActivite>;

/* ═══════════════════════════════════════════════════════════════════════════
   ECRITURE DU REFERENTIEL — ingredients, conditionnements, recettes, lieux
   ───────────────────────────────────────────────────────────────────────────
   Jusqu'ici ces quatre tables n'etaient ecrites QUE par `packages/db/src/seed/`
   (docs/13 §4.7). Consequences constatees : la recette R2 (sans gluten) etait
   semee vide et ne pouvait jamais etre remplie ; un changement de tarif du
   meunier n'etait pas saisissable, donc le cout matiere restait fige au prix de
   la graine ; un second marche etait impossible.

   Tout ce qui suit est de la VALIDATION PURE, partagee entre le navigateur et
   le serveur. Chaque `addIssue` porte un `path`, donc produit un 422 avec
   `champs` (D-035) sans une ligne de code dans le gestionnaire Fastify.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Champs numeriques communs ─────────────────────────────────────────── */

/** Entier facultatif, positif ou nul, avec ses deux messages en francais. */
function champEntierFacultatif(messageType: string, messageSigne: string) {
  return z
    .int(messageType)
    .nonnegative(messageSigne)
    .nullish()
    .transform((valeur) => valeur ?? null);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ingredients — ecriture
   ═══════════════════════════════════════════════════════════════════════════ */

export const schemaCategorieIngredient = z.enum([
  'farine',
  'laitier',
  'oeuf',
  'sucre',
  'garniture',
  'consommable',
  'gaz',
  // Ajoutees le 31/07/2026 (fiche 15 §2.3 et §4.1, `[A TRANCHER]` tranche par
  // le porteur). Avant elles, cafe moulu, chicoree, cannelle et eau n'avaient
  // AUCUN classement honnete — ni garniture, ni consommable, `consommable`
  // etant faite pour le NON-alimentaire (gobelet, serviette).
  //
  // Le porteur a d'abord retenu `boisson` seule, en connaissant sa limite. Un
  // second constat l'a fait revenir dessus le meme jour : l'eau de fleur
  // d'oranger et le sel fin de sa recette R1 etaient DEJA mal classes en
  // `consommable` — un defaut anterieur au cafe, que le cafe a seulement mis en
  // lumiere. D'ou les deux categories.
  //
  // Le partage : `boisson` = ce qui COMPOSE une boisson (cafe moulu, chicoree,
  // eau). `aromate` = ce qui parfume en petite quantite, quel que soit le
  // support (cannelle, fleur d'oranger, sel fin). La cannelle appartient donc a
  // `aromate`, ce qui leve l'ambiguite assumee du premier arbitrage : elle sert
  // aussi bien au cafe qu'en topping de crepe.
  'boisson',
  'aromate',
]);

/**
 * Les 14 allergenes a declaration obligatoire (reglement UE 1169/2011,
 * annexe II), repris tels quels par l'AFSCA.
 *
 * Catalogue en TypeScript et non en base, sur le modele de `CATALOGUE_MOTIFS`
 * (D-013) : c'est une liste REGLEMENTAIRE fermee, pas un parametre que
 * l'utilisateur ajuste. Un allergene en texte libre serait invisible sur
 * l'affichette obligatoire du stand — donc une non-conformite silencieuse.
 *
 * Les codes reprennent EXACTEMENT ceux deja ecrits en base par la graine
 * (`gluten`, `lait`, `oeufs`) : les renommer casserait les ingredients
 * existants.
 */
export const CATALOGUE_ALLERGENES = [
  { code: 'gluten', libelle: 'Céréales contenant du gluten' },
  { code: 'crustaces', libelle: 'Crustacés' },
  { code: 'oeufs', libelle: 'Œufs' },
  { code: 'poissons', libelle: 'Poissons' },
  { code: 'arachides', libelle: 'Arachides' },
  { code: 'soja', libelle: 'Soja' },
  { code: 'lait', libelle: 'Lait (y compris lactose)' },
  { code: 'fruits-a-coque', libelle: 'Fruits à coque' },
  { code: 'celeri', libelle: 'Céleri' },
  { code: 'moutarde', libelle: 'Moutarde' },
  { code: 'sesame', libelle: 'Graines de sésame' },
  { code: 'sulfites', libelle: 'Anhydride sulfureux et sulfites' },
  { code: 'lupin', libelle: 'Lupin' },
  { code: 'mollusques', libelle: 'Mollusques' },
] as const;

const CODES_ALLERGENES = CATALOGUE_ALLERGENES.map((a) => a.code);

export function libelleAllergene(code: string): string {
  return CATALOGUE_ALLERGENES.find((a) => a.code === code)?.libelle ?? code;
}

/**
 * Borne haute de densite. Garde-fou de SAISIE, pas un seuil reglementaire
 * (ceux-la vivent dans `parametre`, CLAUDE.md §7). Aucune denree alimentaire
 * n'atteint 5 g/ml — le sel cristallise, le plus dense de la cuisine, plafonne
 * vers 2,2. Au-dela, c'est une virgule mal placee, et une densite fausse
 * remonte silencieusement jusqu'au cout matiere.
 */
const DENSITE_MAX_G_PAR_ML = 5;

/**
 * Densite en g/ml. `null` est un cas metier normal (aucune conversion
 * masse<->volume n'est necessaire pour cet ingredient) ; `NaN` et `Infinity`
 * ne le sont pas.
 *
 * POURQUOI CETTE GARDE EST DISPROPORTIONNEE EN APPARENCE. `unites.ts` refuse
 * deja de convertir sans densite finie et strictement positive, et D-034
 * explique pourquoi : le stock est la SOMME des mouvements (regle n°5), donc
 * une seule ligne `NaN` rend `NaN` le stock de l'ingredient, sa valorisation,
 * puis tout cout matiere en aval — **sans jamais lever**. Le formulaire doit
 * donc refuser exactement ce que la conversion refuse, sinon la valeur entre en
 * base et n'echoue que trois ecrans plus loin, sans message.
 */
const champDensite = z
  .number('La densité doit être un nombre décimal, en grammes par millilitre.')
  .refine((valeur) => Number.isFinite(valeur), {
    message:
      'La densité doit être un nombre fini. Une densité non finie rendrait incalculable ' +
      "tout le stock de l'ingrédient, sans qu'aucune erreur ne soit levée.",
  })
  .positive('La densité doit être strictement positive.')
  .max(
    DENSITE_MAX_G_PAR_ML,
    `Une densité au-delà de ${DENSITE_MAX_G_PAR_ML} g/ml n'existe pas en alimentaire (le sel, le plus dense, vaut ~2,2). Vérifiez la virgule.`,
  )
  .nullish()
  .transform((valeur) => valeur ?? null);

/** Borne haute du delai de livraison d'un ingredient — meme raison que pour le fournisseur. */
const DELAI_INGREDIENT_MAX_JOURS = 365;

const schemaSaisieIngredientBrute = z.object({
  nom: z.string().trim().min(1, "Le nom de l'ingrédient est obligatoire."),
  categorie: schemaCategorieIngredient,
  /**
   * L'unite dans laquelle TOUT est compte pour cet ingredient : stock,
   * lignes de recette, conditionnements. La changer apres coup reinterpreterait
   * des quantites deja saisies — le depot le refuse donc sur un ingredient
   * qui a deja bouge.
   */
  uniteReference: schemaUnite,
  densiteGParMl: champDensite,
  allergenes: z
    .array(
      z.enum(
        CODES_ALLERGENES as [string, ...string[]],
        'Allergène hors de la liste réglementaire des 14.',
      ),
    )
    .default([]),
  /**
   * Vrai si quelqu'un a explicitement évalué les allergènes de cet ingrédient.
   *
   * FACULTATIF, et SANS transformation vers `null` (contrairement aux autres
   * champs facultatifs de ce schéma) : tant que l'écran de saisie n'a pas
   * encore sa case à cocher, le corps envoyé par le formulaire ne porte pas ce
   * champ du tout, et cette absence doit rester distincte d'un « décoché ».
   * `undefined` = « le formulaire n'a rien dit sur ce point » — le dépôt
   * (`modifierIngredient`, `packages/db/src/depots/referentiel-ecriture.ts`)
   * conserve alors la valeur déjà en base, exactement comme il conserve déjà
   * une note technique de recette absente de l'écran (même fichier,
   * `notesTechniquesExistantes`). Un `false` ou un `true` explicite, eux,
   * changent réellement l'évaluation. À la CRÉATION, une absence vaut `false`
   * (« pas encore évalué ») : c'est le défaut de la colonne elle-même.
   */
  allergenesVerifies: z.boolean().optional(),
  /**
   * Point de commande = consommation moyenne x delai + stock de securite.
   * Il vaut 0 partout aujourd'hui, ce qui rend l'ecran de reapprovisionnement
   * inerte : c'est precisement ce champ qui le reveille.
   */
  stockSecurite: z
    .int('Le stock de sécurité doit être un nombre entier.')
    .nonnegative('Le stock de sécurité ne peut pas être négatif.'),
  delaiLivraisonJours: z
    .int('Le délai de livraison doit être un nombre entier de jours.')
    .nonnegative('Le délai de livraison ne peut pas être négatif.')
    .max(
      DELAI_INGREDIENT_MAX_JOURS,
      `Le délai de livraison doit tenir dans ${DELAI_INGREDIENT_MAX_JOURS} jours.`,
    )
    .nullish()
    .transform((valeur) => valeur ?? null),
  dureeConservationJours: z
    .int('La durée de conservation doit être un nombre entier de jours.')
    .positive('La durée de conservation doit être strictement positive.')
    .nullish()
    .transform((valeur) => valeur ?? null),
  notes: champTexteFacultatif,
});

export type SaisieIngredientBrute = z.infer<typeof schemaSaisieIngredientBrute>;

/**
 * Une quantite en PIECES ne se convertit ni en masse ni en volume : c'est
 * exactement ce que `convertir()` refuse (`unites.ts`). Une densite posee sur un
 * ingredient compte a la piece ne serait donc jamais lue — et une valeur
 * saisie qu'on n'utilise jamais fait croire a une capacite qui n'existe pas.
 */
export function verifierCoherenceIngredient(
  saisie: SaisieIngredientBrute,
  ctx: z.RefinementCtx,
): void {
  if (saisie.uniteReference === 'piece' && saisie.densiteGParMl !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['densiteGParMl'],
      message:
        "Un ingrédient compté à la pièce n'a pas de densité : une pièce ne se convertit ni en " +
        'masse ni en volume. Laissez ce champ vide.',
    });
  }
}

export const schemaSaisieIngredient = schemaSaisieIngredientBrute.superRefine(
  verifierCoherenceIngredient,
);

/**
 * Ingredient tel qu'il sort de l'ecran d'ecriture : la fiche complete, plus ce
 * qui dit ce qu'une desactivation va casser.
 *
 * Distinct de `schemaIngredientReferentiel`, qui decrit `GET /api/ingredients`
 * — cette route ne rend que les ACTIFS et un sous-ensemble des colonnes, et
 * quatre ecrans en dependent. On ajoute a cote, on ne la modifie pas.
 */
export const schemaIngredientComplet = z.object({
  id: z.string(),
  nom: z.string(),
  categorie: schemaCategorieIngredient,
  uniteReference: schemaUnite,
  densiteGParMl: z.number().nullable(),
  allergenes: z.array(z.string()),
  /** Voir `schemaIngredientReferentiel` : même drapeau, même doctrine. */
  allergenesVerifies: z.boolean(),
  stockSecurite: z.int(),
  delaiLivraisonJours: z.int().nullable(),
  dureeConservationJours: z.int().nullable(),
  notes: z.string().nullable(),
  actif: z.boolean(),
  /** Conditionnements ACTIFS rattaches : sans un seul, aucune commande n'est generable. */
  nbConditionnements: z.int(),
  /**
   * Cout unitaire de reference en centimes par unite, `null` si aucun
   * conditionnement actif. Non arrondi : `prix_cents / quantite_unite_ref`
   * (D-018), jamais un prix unitaire stocke.
   */
  coutUnitaireCents: z.number().nullable(),
  /** Nombre de lignes de recette qui citent cet ingredient. */
  nbLignesRecette: z.int(),
  /** Nombre de lots recus. Ce qui interdit de changer l'unite de reference. */
  nbLots: z.int(),
});

export const schemaListeIngredientsComplets = z.object({
  data: z.array(schemaIngredientComplet),
  meta: z.object({ total: z.int() }),
});

/* ═══════════════════════════════════════════════════════════════════════════
   Conditionnements — le format d'achat, et donc LE PRIX
   ═══════════════════════════════════════════════════════════════════════════ */

/** Jour civil `AAAA-MM-JJ`. */
const champJourCivil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ, par exemple 2026-07-28.')
  // La FORME ne suffit pas : `2026-02-30` la respecte et n'existe pas.
  .refine(estJourCivilValide, 'Cette date n’existe pas au calendrier.');

export const schemaConditionnement = z.object({
  id: z.string(),
  ingredientId: z.string(),
  ingredientNom: z.string(),
  uniteReference: schemaUnite,
  fournisseurId: z.string(),
  fournisseurNom: z.string(),
  libelle: z.string(),
  quantiteUniteRef: z.int(),
  prixCents: z.int(),
  referenceFournisseur: z.string().nullable(),
  datePrix: z.string(),
  actif: z.boolean(),
});

export const schemaListeConditionnements = z.object({
  data: z.array(schemaConditionnement),
  meta: z.object({ total: z.int() }),
});

export const schemaSaisieConditionnement = z.object({
  ingredientId: z.string().min(1, "Choisissez l'ingrédient conditionné."),
  fournisseurId: z.string().min(1, 'Choisissez le fournisseur qui livre ce conditionnement.'),
  libelle: z
    .string()
    .trim()
    .min(
      1,
      'Le libellé est obligatoire : c’est lui qui figure sur le bon de commande (« Sac 25 kg »).',
    ),
  /**
   * Contenance dans l'unite de reference de l'ingredient. Strictement positive :
   * le prix unitaire vaut `prix_cents / quantite_unite_ref`, donc zero
   * produirait une division par zero jusque dans le cout matiere.
   */
  quantiteUniteRef: z
    .int('La contenance doit être un nombre entier, dans l’unité de l’ingrédient.')
    .positive('La contenance doit être strictement positive : elle divise le prix.'),
  /** CLAUDE.md §3 : argent en centimes ENTIERS. La saisie en euros est convertie à la frontière. */
  prixCents: z
    .int('Le prix doit être un nombre entier de centimes.')
    .nonnegative('Le prix ne peut pas être négatif.'),
  /**
   * Reference article du fournisseur. Colonne morte jusqu'ici (docs/13 §3.2) —
   * c'est pourtant elle qu'on cite au telephone au meunier.
   */
  referenceFournisseur: champTexteFacultatif,
  datePrix: champJourCivil,
});

export type SaisieConditionnement = z.infer<typeof schemaSaisieConditionnement>;

/**
 * Changement de TARIF, distinct d'une correction de fiche.
 *
 * Meme distinction que D-042 pour les parametres, pour la meme raison : le prix
 * porte une DATE. « Le meunier a augmenté au 1er septembre » et « je m'étais
 * trompé en tapant le prix » ne sont pas le meme geste. Le premier ajoute une
 * ligne datee (l'ancienne reste, et c'est elle qui repond a « à quel prix
 * achetais-je en mars ? ») ; le second reecrit en place.
 */
export const schemaNouveauTarif = z.object({
  prixCents: z
    .int('Le prix doit être un nombre entier de centimes.')
    .nonnegative('Le prix ne peut pas être négatif.'),
  datePrix: champJourCivil,
  referenceFournisseur: champTexteFacultatif,
});

export type NouveauTarif = z.infer<typeof schemaNouveauTarif>;

/* ═══════════════════════════════════════════════════════════════════════════
   Recettes — ecriture et VERSIONNAGE (D-005)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Borne des pertes, en points de base. 10 000 bp = 100 % : une recette qui perd
 * tout ne produit rien, et `mettreAEchelle` leve alors `rendement_net_nul`.
 * On refuse au formulaire plutot que trois ecrans plus loin.
 */
const PERTE_MAX_BP = 9_000;

export const schemaLigneSaisieRecette = z.object({
  ingredientId: z.string().min(1, 'Choisissez un ingrédient.'),
  quantiteUniteRef: z
    .int("La quantité doit être un nombre entier, dans l'unité de l'ingrédient.")
    .positive('La quantité doit être strictement positive.'),
  noteTechnique: champTexteFacultatif,
});

const schemaSaisieRecetteBrute = z.object({
  code: z
    .string()
    .trim()
    .min(
      1,
      'Le code est obligatoire : c’est lui qui identifie la recette et ses versions (« R1 »).',
    )
    .max(16, 'Le code doit tenir en 16 caractères.'),
  nom: z.string().trim().min(1, 'Le nom de la recette est obligatoire.'),
  typePate: z
    .string()
    .trim()
    .min(1, 'Le type de pâte est obligatoire (« froment », « sarrasin »).'),
  sansGluten: z.boolean(),
  rendementReferenceMl: z
    .int('Le volume de référence doit être un nombre entier de millilitres.')
    .positive('Le volume de référence doit être strictement positif.'),
  rendementReferenceCrepes: z
    .int('Le rendement de référence doit être un nombre entier de crêpes.')
    .positive('Le rendement de référence doit être strictement positif.'),
  perteCuissonBp: z
    .int('La perte de cuisson doit être un nombre entier de points de base.')
    .nonnegative('La perte de cuisson ne peut pas être négative.')
    .max(
      PERTE_MAX_BP,
      `La perte de cuisson ne peut pas dépasser ${PERTE_MAX_BP} points de base (90 %).`,
    ),
  tauxCasseBp: z
    .int('Le taux de casse doit être un nombre entier de points de base.')
    .nonnegative('Le taux de casse ne peut pas être négatif.')
    .max(
      PERTE_MAX_BP,
      `Le taux de casse ne peut pas dépasser ${PERTE_MAX_BP} points de base (90 %).`,
    ),
  perteFixeMl: champEntierFacultatif(
    'La perte fixe doit être un nombre entier de millilitres.',
    'La perte fixe ne peut pas être négative.',
  ).transform((valeur) => valeur ?? 0),
  procede: champTexteFacultatif,
  notes: champTexteFacultatif,
  lignes: z.array(schemaLigneSaisieRecette),
});

export type SaisieRecetteBrute = z.infer<typeof schemaSaisieRecetteBrute>;

/**
 * Deux regles que le schema de table ne peut pas porter.
 *
 * 1. **Un ingredient au plus une fois par recette.** `recette_ligne` porte un
 *    index unique `(recette_id, ingredient_id)` : sans ce controle, un doublon
 *    remonterait en contrainte SQLite brute, donc en 500 « erreur inattendue »
 *    (D-035), alors que c'est une faute de saisie.
 * 2. **Les deux pertes ne peuvent pas annuler toute la production.** Elles
 *    s'appliquent en CASCADE (`rendementNetBp`), pas en somme : 9 000 bp et
 *    9 000 bp laissent 1 % — legal mais absurde. On ne refuse que le cas ou il
 *    ne reste rien, que `mettreAEchelle` refuserait de toute facon.
 */
export function verifierCoherenceRecette(saisie: SaisieRecetteBrute, ctx: z.RefinementCtx): void {
  const vus = new Set<string>();
  saisie.lignes.forEach((ligne, index) => {
    if (vus.has(ligne.ingredientId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['lignes', index, 'ingredientId'],
        message:
          'Cet ingrédient figure déjà dans la recette. Additionnez les quantités sur une seule ' +
          'ligne plutôt que d’en créer une seconde.',
      });
    }
    vus.add(ligne.ingredientId);
  });
}

export const schemaSaisieRecette = schemaSaisieRecetteBrute.superRefine(verifierCoherenceRecette);

export type SaisieRecette = z.infer<typeof schemaSaisieRecette>;

/**
 * Changement de statut d'une recette.
 *
 * Indispensable, et pas cosmetique : `lancerProduction` refuse toute recette qui
 * n'est pas `active`. Sans ce geste, R2 remplie resterait un brouillon
 * inproductible — on aurait rendu la saisie possible sans rendre la recette
 * utilisable.
 */
export const schemaChangementStatutRecette = z.object({
  statut: schemaStatutRecette,
});

/**
 * Alias du statut de recette. `contrats/recettes.ts` declare le schema mais
 * n'en exporte pas le type ; le depot d'ecriture en a besoin pour typer son
 * parametre sans le redeclarer a la main.
 */
export type StatutRecette = z.infer<typeof schemaStatutRecette>;

/**
 * Ce que le serveur rend apres avoir cree une version.
 *
 * `produitsSurVersionPrecedente` n'est pas decoratif : `produit_vente.recette_id`
 * pointe une VERSION precise. Creer R1 v2 laisse donc les produits accroches a
 * v1, qui vient d'etre archivee. On ne les redirige PAS en silence — repointer
 * un produit change ce qui sera consomme au prochain marche — mais on dit
 * combien il y en a, sinon personne ne le decouvre.
 */
export const schemaResultatVersionRecette = z.object({
  id: z.string(),
  code: z.string(),
  version: z.int(),
  recetteParentId: z.string(),
  produitsSurVersionPrecedente: z.int(),
});

export type ResultatVersionRecette = z.infer<typeof schemaResultatVersionRecette>;

/**
 * Ce que l'ecran a besoin de savoir AVANT de proposer un geste sur une recette.
 *
 * `GET /api/recettes` (routes/recettes.ts) rend le resume metier : code, nom,
 * statut, cout par crepe. Il ne dit pas la seule chose qui decide entre
 * « modifier » et « versionner » : **combien de productions referencent cette
 * version**. C'est le critere de D-005, et il n'est pas le statut.
 *
 * Sans ce compte, l'ecran ne pourrait offrir qu'un bouton unique et laisser le
 * serveur refuser apres coup. L'utilisateur decouvrirait la regle par un
 * message d'erreur, alors qu'elle doit etre lisible avant le clic — c'est ce que
 * fait l'ecran Parametres avec ses deux boutons nommes (D-042).
 *
 * `nbProduits` accompagne : creer une version archive la precedente, or
 * `produit_vente.recette_id` pointe une VERSION precise. Le nombre de produits
 * qui vont rester accroches a l'ancienne doit etre annonce avant, pas apres.
 */
/**
 * Une note technique persistée sur une ligne de recette : le geste
 * (« beurre noisette, ne pas dépasser la coloration »), pas l'allergène — deux
 * informations aux exigences différentes, jamais à confondre (CLAUDE.md §7).
 * Sa place est la fiche technique, imprimée ou à l'écran — c'est justement le
 * document qu'on emporte.
 */
export const schemaNoteTechniqueLigneRecette = z.object({
  ingredientId: z.string(),
  nomIngredient: z.string(),
  noteTechnique: z.string(),
});

export const schemaRecetteReferentiel = z.object({
  id: z.string(),
  code: z.string(),
  nom: z.string(),
  version: z.int(),
  statut: schemaStatutRecette,
  sansGluten: z.boolean(),
  /** Version dont celle-ci descend (D-005). `null` pour une v1. */
  recetteParentId: z.string().nullable(),
  nbLignes: z.int(),
  /** > 0 : la recette est SCELLEE, elle ne se modifie plus (D-005). */
  nbProductions: z.int(),
  nbProduits: z.int(),
  /**
   * Notes techniques NON VIDES de cette recette (audit du 30/07/2026 :
   * `recette_ligne.note_technique` était écrite, jamais exposée par aucun
   * contrat de lecture — ni `schemaRecetteDetail`, ni ici avant ce jour).
   * Une ligne sans note est simplement absente de ce tableau ; l'absence
   * d'une entrée ne dit RIEN sur les allergènes de l'ingrédient concerné.
   */
  notesTechniques: z.array(schemaNoteTechniqueLigneRecette),
});

export const schemaListeRecettesReferentiel = z.object({
  data: z.array(schemaRecetteReferentiel),
  meta: z.object({ total: z.int() }),
});

export type NoteTechniqueLigneRecette = z.infer<typeof schemaNoteTechniqueLigneRecette>;
export type RecetteReferentiel = z.infer<typeof schemaRecetteReferentiel>;
export type ListeRecettesReferentiel = z.infer<typeof schemaListeRecettesReferentiel>;

/* ═══════════════════════════════════════════════════════════════════════════
   Lieux de marche
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Résultat d'une TENTATIVE de calcul automatique de distance, PENDANT LA
 * REQUÊTE d'écriture en cours (D-064, séance du 30/07/2026 — le porteur
 * demande un calcul automatique de la distance routière, via OpenRouteService,
 * `apps/api/src/itineraire/client.ts`).
 *
 * CE N'EST PAS UN ÉTAT PERSISTANT DU LIEU. Rien en base ne mémorise
 * aujourd'hui si `distanceKm` vient d'un calcul automatique ou d'une saisie
 * manuelle (voir le rapport de l'agent — colonne `distance_km_origine`
 * proposée, non créée : `packages/db/src/schema.ts` est hors zone d'écriture).
 * `POST /api/lieux` et `PATCH /api/lieux/:id` renvoient donc ce champ non nul
 * UNIQUEMENT quand une tentative a eu lieu PENDANT CETTE REQUÊTE précise —
 * c'est le seul moment où l'attribution OpenStreetMap doit être montrée au
 * porteur pour qu'il vérifie le chiffre (CLAUDE.md §5, la vérification
 * humaine reste requise). Une simple lecture (`GET /api/referentiel/lieux`)
 * ne tente jamais de calcul (CLAUDE.md §5 : « un appel par lieu, jamais par
 * affichage ») et rend donc toujours `null` ici, y compris pour un lieu dont
 * la distance a été calculée automatiquement lors d'une requête passée.
 */
export const schemaResultatCalculAutomatiqueDistance = z.discriminatedUnion('reussi', [
  z.object({
    reussi: z.literal(true),
    /** Mention CC-BY 4.0 obligatoire partout où cette distance est affichée. */
    attribution: z.string(),
  }),
  z.object({
    reussi: z.literal(false),
    /** Motif nommé en français, affichable tel quel — jamais un silence. */
    raison: z.string(),
  }),
]);

export type ResultatCalculAutomatiqueDistance = z.infer<
  typeof schemaResultatCalculAutomatiqueDistance
>;

export const schemaModeTarification = z.enum(['metre_lineaire_mois', 'jour', 'forfait']);

/**
 * Mode de facturation de l'électricité sur un emplacement (fiche 17, D-055).
 *
 * `null` = inconnu, jamais « au compteur » : sur beaucoup de marchés
 * l'électricité est comprise dans le prix de l'emplacement ou facturée au
 * forfait journalier — deviner « compteur » inventerait une consommation en
 * kWh qui n'existe pas et la compterait deux fois avec le tarif d'emplacement.
 */
export const schemaFacturationElectricite = z.enum(['compteur', 'forfait', 'comprise', 'aucune']);

export const schemaLieuComplet = z.object({
  id: z.string(),
  nom: z.string(),
  adresse: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  jourSemaine: z.int().nullable(),
  heureDebut: z.string().nullable(),
  heureFin: z.string().nullable(),
  tarifEmplacementCents: z.int().nullable(),
  modeTarification: schemaModeTarification.nullable(),
  metresLineaires: z.int().nullable(),
  /**
   * Distance routière aller simple depuis le point de départ habituel, en km
   * (fiche 13). `null` = non renseignée, jamais 0 km : un lieu sans distance
   * ne peut pas être comparé aux autres sur la marge nette attendue.
   *
   * DÉCIMALE depuis le 31/07/2026 (D-074), et ce n'est pas un relâchement :
   * `apps/api/src/itineraire/client.ts` rend des mètres, désormais arrondis
   * au dixième de km et non plus au kilomètre entier — un `z.int()` ici
   * referait un 422 sur la première distance non ronde. La règle 4 du §3
   * n'impose l'entier qu'aux MASSES et aux VOLUMES ; une distance routière se
   * lit « 23,4 km ». Même décision que `schemaLigneComparaisonLieu.distanceKm`
   * (`packages/core/src/contrats/lieux.ts`).
   */
  distanceKm: z.number().nullable(),
  facturationElectricite: schemaFacturationElectricite.nullable(),
  /** Puissance électrique DISPONIBLE sur l'emplacement, en watts (fiche 17). */
  puissanceDisponibleW: z.int().nullable(),
  notes: z.string().nullable(),
  actif: z.boolean(),
  /** Sessions deja tenues sur ce lieu. Ce qui interdit la suppression. */
  nbSessions: z.int(),
  /**
   * Résultat d'un calcul automatique de distance TENTÉ PENDANT CETTE
   * REQUÊTE — voir `schemaResultatCalculAutomatiqueDistance` ci-dessous.
   * `.default(null)` : le dépôt (`listerLieuxComplets`) ne connaît pas ce
   * champ, une lecture ordinaire le laisse donc absent et Zod le complète à
   * `null` sans qu'il faille toucher `packages/db`.
   */
  distanceCalculAutomatique: schemaResultatCalculAutomatiqueDistance.nullable().default(null),
});

export const schemaListeLieuxComplets = z.object({
  data: z.array(schemaLieuComplet),
  meta: z.object({ total: z.int() }),
});

/** `HH:MM` sur 24 h. */
const champHeure = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure attendue au format HH:MM, par exemple 08:00.')
  .nullish()
  .transform((valeur) =>
    valeur === undefined || valeur === null || valeur === '' ? null : valeur,
  );

const schemaSaisieLieuBrute = z.object({
  nom: z.string().trim().min(1, 'Le nom du lieu est obligatoire.'),
  adresse: champTexteFacultatif,
  /**
   * Coordonnees WGS84. Ce sont ELLES que le moteur de prevision passe a
   * Open-Meteo (`apps/api/src/routes/previsions.ts`) : sans elles, la route
   * repond « Le lieu n'a pas de coordonnées » et le facteur meteo est
   * neutralise. Un lieu sans coordonnees reste creable — un marche couvert n'a
   * pas besoin de meteo — mais l'ecran doit le dire.
   */
  latitude: z
    .number('La latitude doit être un nombre décimal.')
    .refine((v) => Number.isFinite(v), { message: 'La latitude doit être un nombre fini.' })
    .min(-90, 'La latitude est comprise entre -90 et 90.')
    .max(90, 'La latitude est comprise entre -90 et 90.')
    .nullish()
    .transform((valeur) => valeur ?? null),
  longitude: z
    .number('La longitude doit être un nombre décimal.')
    .refine((v) => Number.isFinite(v), { message: 'La longitude doit être un nombre fini.' })
    .min(-180, 'La longitude est comprise entre -180 et 180.')
    .max(180, 'La longitude est comprise entre -180 et 180.')
    .nullish()
    .transform((valeur) => valeur ?? null),
  /** 0 = dimanche, comme `Date.getDay()`. La Batte se tient le dimanche. */
  jourSemaine: z
    .int('Le jour de semaine doit être un entier de 0 (dimanche) à 6 (samedi).')
    .min(0, 'Le jour de semaine doit être un entier de 0 (dimanche) à 6 (samedi).')
    .max(6, 'Le jour de semaine doit être un entier de 0 (dimanche) à 6 (samedi).')
    .nullish()
    .transform((valeur) => valeur ?? null),
  heureDebut: champHeure,
  heureFin: champHeure,
  tarifEmplacementCents: champEntierFacultatif(
    "Le tarif d'emplacement doit être un nombre entier de centimes.",
    "Le tarif d'emplacement ne peut pas être négatif.",
  ),
  modeTarification: schemaModeTarification.nullish().transform((valeur) => valeur ?? null),
  metresLineaires: z
    .int('Le métrage doit être un nombre entier de mètres.')
    .positive('Le métrage doit être strictement positif.')
    .nullish()
    .transform((valeur) => valeur ?? null),
  /**
   * Distance ROUTIÈRE aller simple, saisie à la main et non calculée depuis
   * les coordonnées : un calcul à vol d'oiseau se trompe couramment de 20 à
   * 40 % sur le réseau réel (docs/demandes/13 §5.2). `null` (champ vide) =
   * non renseignée, jamais 0 km.
   *
   * DÉCIMALE depuis le 31/07/2026 (D-074), et ce n'est PAS un relâchement de
   * la règle 4 du §3 (« masses en grammes, volumes en millilitres, tous deux
   * en entiers ») : cette règle ne porte que sur les MASSES et les VOLUMES,
   * jamais sur les distances — une distance routière se lit « 23,4 km ».
   * `apps/api/src/itineraire/client.ts` rend désormais des mètres arrondis au
   * DIXIÈME de km, et non plus au km entier : un `z.int()` (via
   * `champEntierFacultatif`, utilisé ici jusqu'à cette date) referait un 422
   * sur la première distance non ronde — et la route d'écriture relit sa
   * propre écriture par un `.parse()` juste après l'avoir enregistrée, donc
   * le refus tomberait APRÈS que la distance a été calculée et stockée. Même
   * décision que `schemaLigneComparaisonLieu.distanceKm`
   * (`packages/core/src/contrats/lieux.ts`). Champ dédié plutôt que
   * `champEntierFacultatif` : ce dernier impose `.int()`, qui est exactement
   * ce qu'il faut éviter ici — aucun autre champ de ce fichier n'a besoin
   * d'un équivalent décimal, donc pas de généralisation prématurée.
   */
  distanceKm: z
    .number('La distance doit être un nombre décimal de kilomètres.')
    .refine((v) => Number.isFinite(v), {
      message: 'La distance doit être un nombre fini.',
    })
    .nonnegative('La distance ne peut pas être négative.')
    .nullish()
    .transform((valeur) => valeur ?? null),
  facturationElectricite: schemaFacturationElectricite
    .nullish()
    .transform((valeur) => valeur ?? null),
  puissanceDisponibleW: champEntierFacultatif(
    'La puissance disponible doit être un nombre entier de watts.',
    'La puissance disponible ne peut pas être négative.',
  ),
  notes: champTexteFacultatif,
});

export type SaisieLieuBrute = z.infer<typeof schemaSaisieLieuBrute>;

/**
 * Trois regles metier du lieu.
 *
 * 1. **Une coordonnee seule ne sert a rien.** `releverMeteo` exige le couple :
 *    une latitude sans longitude laisse le facteur meteo mort, sans que rien ne
 *    le signale — exactement le profil de defaut que docs/13 recense.
 * 2. **La fenetre horaire doit avoir une duree.** Elle borne l'appel Open-Meteo
 *    et la capacite de cuisson ; `fin <= debut` donnerait une fenetre nulle ou
 *    negative, donc une capacite de cuisson nulle.
 * 3. **Un tarif au metre lineaire exige un metrage.** Sans lui, le tarif n'est
 *    pas multipliable : le cout d'emplacement resterait inconnu alors qu'il
 *    entre dans la marge de session.
 */
export function verifierCoherenceLieu(saisie: SaisieLieuBrute, ctx: z.RefinementCtx): void {
  if (saisie.latitude !== null && saisie.longitude === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['longitude'],
      message:
        'Une latitude sans longitude ne localise rien : la météo ne pourra pas être relevée. ' +
        'Renseignez les deux, ou aucune.',
    });
  }
  if (saisie.longitude !== null && saisie.latitude === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['latitude'],
      message:
        'Une longitude sans latitude ne localise rien : la météo ne pourra pas être relevée. ' +
        'Renseignez les deux, ou aucune.',
    });
  }

  if (
    saisie.heureDebut !== null &&
    saisie.heureFin !== null &&
    saisie.heureFin <= saisie.heureDebut
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['heureFin'],
      message: `L'heure de fin (${saisie.heureFin}) doit être postérieure à l'heure de début (${saisie.heureDebut}).`,
    });
  }

  if (saisie.modeTarification === 'metre_lineaire_mois' && saisie.metresLineaires === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['metresLineaires'],
      message:
        'Un tarif au mètre linéaire ne se calcule pas sans métrage. Indiquez le nombre de mètres ' +
        'occupés par le stand.',
    });
  }
}

export const schemaSaisieLieu = schemaSaisieLieuBrute.superRefine(verifierCoherenceLieu);

export type SaisieLieu = z.infer<typeof schemaSaisieLieu>;

export type CategorieIngredient = z.infer<typeof schemaCategorieIngredient>;
export type SaisieIngredient = z.infer<typeof schemaSaisieIngredient>;
export type IngredientComplet = z.infer<typeof schemaIngredientComplet>;
export type ListeIngredientsComplets = z.infer<typeof schemaListeIngredientsComplets>;
export type Conditionnement = z.infer<typeof schemaConditionnement>;
export type ListeConditionnements = z.infer<typeof schemaListeConditionnements>;
export type LigneSaisieRecette = z.infer<typeof schemaLigneSaisieRecette>;
export type ChangementStatutRecette = z.infer<typeof schemaChangementStatutRecette>;
export type ModeTarification = z.infer<typeof schemaModeTarification>;
export type FacturationElectricite = z.infer<typeof schemaFacturationElectricite>;
export type LieuComplet = z.infer<typeof schemaLieuComplet>;
export type ListeLieuxComplets = z.infer<typeof schemaListeLieuxComplets>;
