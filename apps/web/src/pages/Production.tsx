import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GLYPHE_STATUT,
  TIRET_ABSENT,
  formaterDate,
  formaterDateHeure,
  formaterEcartPourcent,
  formaterEuros,
  formaterJoursRestants,
  formaterMontant,
  formaterQuantite,
  libelleUnite,
  messageFaisabilite,
  ouTiret,
  schemaAnnulationProductionCreee,
  schemaFaisabilite,
  schemaListePrevisions,
  schemaListeProductions,
  schemaListeRecettes,
  schemaListeSessions,
  schemaListeParametres,
  schemaProductionDetail,
  type BesoinIngredientContrat,
  type CibleProduction,
  type ConsommationProduction,
  type Faisabilite,
  type Parametre,
  type PrevisionArchivee,
  type ProductionDetail,
  type ProductionResume,
  type RecetteResume,
  type SessionResume,
  type Statut,
} from '@batte/core';
import { BoutonDocument } from '../composants/BoutonDocument';
import { PastilleStatut } from '../composants/affichage';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { MessageErreur } from '../composants/EncartErreur';
import { ErreurApi, requeteApi } from '../lib/api';
import { aujourdHui } from '../lib/dates';
import {
  blocageAnnulationProduction,
  phraseApresAnnulationProduction,
  phraseAvantAnnulationProduction,
} from '../saisie-stock/annulation';
import { BlocAnnulation } from '../saisie-stock/BlocAnnulation';
import { AUCUNE_ERREUR, repartirErreurApi, type ErreursFormulaire } from '../saisie-stock/champs';
import { compteAccorde } from './pluriel';

/**
 * Ecran Production (docs/01 module 3 ; docs/07 §6.3).
 *
 * Parcours en un seul ecran, dans l'ordre impose par docs/01 :
 *  1. choix de la recette (seules les recettes `active` sont produisibles) et
 *     de la cible (crepes ou volume) ;
 *  2. controle de faisabilite EN DIRECT, recalcule a la saisie apres un
 *     debounce de 300 ms — le coeur de l'ecran (panneau « Nouvel ordre ») ;
 *  3. validation -> lance la production (ecriture atomique, irreversible
 *     cote stock) ;
 *  4. saisie du realise sur une production deja lancee, dans le panneau de
 *     detail ouvert en cliquant une ligne de l'historique.
 *
 * Regle d'architecture n°1 (CLAUDE.md §3) : ce composant n'effectue AUCUN
 * calcul metier. Le message « il manque X de Y » (docs/07 §6.3) n'est PAS
 * reconstruit ici : c'est `messageFaisabilite` de `@batte/core`, deja ecrite
 * pour cet usage exact dans `packages/core/src/production.ts`, qui le
 * produit a partir du `ingredientLimitant` renvoye par l'API. Le tri des
 * besoins (manquants d'abord) et le mappage statut -> glyphe sont de la
 * presentation pure (docs/07 §4.5 l'autorise explicitement), jamais un
 * calcul sur une donnee metier — meme principe que `statutLigne` dans
 * `Stock.tsx`.
 *
 * Mise en page : panneau d'action en haut (meme gabarit que le
 * « Calculateur » de `Recettes.tsx` : champs + resultat dans UN seul
 * panneau, separes par un filet, jamais un second panneau imbrique),
 * puis historique + detail docked exactement comme `Stock.tsx`
 * (liste a gauche, detail contextuel a droite, ni modale ni page).
 */

/* Date du jour lue à chaque appel, jamais figée à l'import : voir `aujourdHui`
   dans `lib/dates.ts`. */
const DELAI_DEBOUNCE_MS = 300;

type TypeCibleProduction = 'crepes' | 'volume';

type EtatRecettesEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; recettes: RecetteResume[] };

/**
 * Sessions candidates au rattachement (docs/14 G1/G4). Chargees une fois,
 * comme les recettes : le rattachement se fait au lancement ET après coup,
 * les deux formulaires partagent la même liste.
 */
type EtatSessionsEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; sessions: SessionResume[] };

/**
 * Previsions archivees (docs/03, D-058), chargees une fois comme les
 * sessions : sert a retrouver, pour la session choisie ci-dessus, LA
 * prevision qui la motive — voir `previsionRetenue` plus bas. Une erreur de
 * chargement ne bloque PAS le lancement (l'IA/le modele est un confort,
 * jamais une dependance, CLAUDE.md §5) : elle se traduit juste par l'absence
 * de prevision a proposer, jamais par un formulaire bloque.
 */
type EtatPrevisionsEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur' }
  | { statut: 'pret'; previsions: PrevisionArchivee[] };

type EtatHistoriqueEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; productions: ProductionResume[]; total: number };

type EtatFaisabiliteEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; resultat: Faisabilite };

type EtatDetailEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; detail: ProductionDetail };

/**
 * Machine a etats commune aux deux ecritures de l'ecran (lancement, saisie du
 * realise). `succes` est TRANSITOIRE (docs/07 §4.7 : « succes 5 s, erreur
 * persistante ») ; `erreur` reste affichee jusqu'a la prochaine tentative.
 */
type EtatEcritureEcran =
  | { statut: 'inactif' }
  | { statut: 'en_cours' }
  | { statut: 'succes'; message: string }
  | { statut: 'erreur'; message: string };

const LIBELLE_STATUT_PRODUCTION: Readonly<Record<ProductionResume['statut'], string>> = {
  lancee: 'En cours',
  terminee: 'Terminée',
  annulee: 'Annulée',
};

/**
 * Trois etats de production ramenes a l'echelle a trois etats du produit :
 * `lancee` demande une action (saisir le realise) donc se lit comme une
 * alerte, `terminee` est conforme, `annulee` — ecriture d'annulation, jamais
 * une suppression (docs/07 §1.4) — se lit comme un depassement. Simple
 * mappage fixe, aucun calcul (meme principe que `statutAffichageLot` dans
 * `Stock.tsx`).
 */
function statutAffichageProduction(statut: ProductionResume['statut']): Statut {
  switch (statut) {
    case 'lancee':
      return 'alerte';
    case 'terminee':
      return 'conforme';
    case 'annulee':
      return 'depassement';
  }
}

/** Mappage d'affichage pur : `manquant` est deja calcule par l'API
 * (`controlerFaisabilite` dans `packages/core/src/production.ts`) — ici, un
 * seul choix de glyphe, pas un calcul metier. */
function statutBesoin(besoin: BesoinIngredientContrat): Statut {
  return besoin.manquant > 0 ? 'depassement' : 'conforme';
}

/**
 * Reordonne l'affichage des besoins : les manquants d'abord — DANS L'ORDRE
 * DEJA CALCULE par l'API (le plus contraignant en tete, cf. le commentaire de
 * `manquants` dans le contrat) — puis le reste dans l'ordre de la recette.
 * Un tri n'est jamais alphabetique, il reflete l'action (docs/07 §4.5) ;
 * c'est une REORDONNANCE de tableaux deja fournis, aucune valeur n'est
 * recalculee.
 */
function trierBesoins(resultat: Faisabilite): BesoinIngredientContrat[] {
  const idsManquants = new Set(resultat.manquants.map((m) => m.ingredientId));
  const conformes = resultat.besoins.filter((b) => !idsManquants.has(b.ingredientId));
  return [...resultat.manquants, ...conformes];
}

/** Tri par urgence : la production la plus recente d'abord (docs/07 §4.5,
 * « jamais alphabetique »). Egalite de date departagee par l'identifiant —
 * un UUID v7 est nativement trie par ordre chronologique (identifiants.ts). */
function comparerProductions(a: ProductionResume, b: ProductionResume): number {
  const parDate = b.dateProduction.localeCompare(a.dateProduction);
  return parDate !== 0 ? parDate : b.id.localeCompare(a.id);
}

/**
 * Valeur ENTIERE en vigueur d'un parametre du catalogue, a partir d'une
 * reponse deja validee de `GET /parametres`. Dupliquee depuis `Stock.tsx`
 * (meme resolution que `regrouperParCle` dans `Parametres.tsx`) : aucun
 * fichier hors `apps/web/src/pages/**` n'est dans la zone d'ecriture de cette
 * mission — a redescendre dans `apps/web/src/lib/` des que cette contrainte
 * se leve. Rend `null` si la cle est absente : mieux vaut un horizon
 * silencieusement absent qu'une valeur inventee.
 */
function valeurEntiereParametre(
  lignes: readonly Parametre[],
  cle: string,
  jour: string,
): number | null {
  const versions = lignes
    .filter((p) => p.cle === cle)
    .sort((a, b) => b.dateDebutValidite.localeCompare(a.dateDebutValidite));
  if (versions.length === 0) return null;
  const enVigueur =
    versions.find((v) => v.dateDebutValidite <= jour) ?? versions[versions.length - 1]!;
  return Number.parseInt(enVigueur.valeur, 10);
}

/**
 * DLC + compteur relatif, identique au traitement de `Stock.tsx` — la DLC
 * d'un lot de pate n'est jamais nulle (elle est fixee a 24 h a la creation
 * du lot, docs/01 module 3), donc pas de cas absent a traiter ici.
 *
 * `horizonDlcJours` VIENT DU MEME PARAMETRE que `Stock.tsx`
 * (`brief_horizon_alerte_dlc_jours`, correctif « brief vs ecrans »,
 * 01/08/2026, docs/29-VALEURS-EN-DUR.md §4) — plus un defaut fige a 14 dans
 * `formaterJoursRestants`. `null` tant que non charge : aucun compteur ne
 * s'affiche plutot que d'en inventer un.
 */
function rendreDlcPate(dlc: string, horizonDlcJours: number | null) {
  if (horizonDlcJours === null) return formaterDate(dlc);
  const compteur = formaterJoursRestants(dlc, aujourdHui(), horizonDlcJours);
  if (compteur === null) return formaterDate(dlc);
  return (
    <span className="inline-flex items-baseline gap-groupe">
      <span>{formaterDate(dlc)}</span>
      <span className="text-xs text-ink-3">{compteur}</span>
    </span>
  );
}

/** Version TEXTE de `rendreDlcPate`, pour l'infobulle : elle doit restituer
 * exactement ce que la cellule affiche, compteur de jours compris. Deux rendus
 * du même contenu, une seule source de vérité pour le compteur. */
function libelleDlcPate(dlc: string, horizonDlcJours: number | null): string {
  if (horizonDlcJours === null) return formaterDate(dlc);
  const compteur = formaterJoursRestants(dlc, aujourdHui(), horizonDlcJours);
  return compteur === null ? formaterDate(dlc) : `${formaterDate(dlc)} ${compteur}`;
}

/**
 * Lit une saisie d'entier strictement positif (nombre de crepes, volume en
 * ml). Rend `null` plutot que de deviner un zero — meme logique que
 * `parserEuros` dans `packages/core/src/argent.ts`.
 */
function parserEntierPositif(saisie: string): number | null {
  const nettoyee = saisie.trim();
  if (!/^\d+$/.test(nettoyee)) return null;
  const valeur = Number.parseInt(nettoyee, 10);
  return valeur > 0 ? valeur : null;
}

/** Meme lecture, mais un realise peut legitimement etre nul (pate entierement
 * jetee, casse totale) : `0` est une valeur, pas une absence. */
function parserEntierNonNegatif(saisie: string): number | null {
  const nettoyee = saisie.trim();
  if (!/^\d+$/.test(nettoyee)) return null;
  return Number.parseInt(nettoyee, 10);
}

function messageErreurValeur(cible: TypeCibleProduction): string {
  return cible === 'crepes'
    ? 'Le nombre de crêpes doit être un nombre entier positif.'
    : 'Le volume doit être un nombre entier positif, en millilitres.';
}

function libelleChampValeur(cible: TypeCibleProduction): string {
  return cible === 'crepes' ? 'Nombre de crêpes visé' : 'Volume de pâte visé (ml)';
}

/** Valeur de depart REELLE tiree de la recette (CLAUDE.md §7 : jamais un
 * chiffre invente), analogue a `choisirCible` dans `Recettes.tsx`. */
function valeurReference(recette: RecetteResume, cible: TypeCibleProduction): number {
  return cible === 'crepes' ? recette.rendementReferenceCrepes : recette.rendementReferenceMl;
}

/**
 * Formate un compte entier de crepes. Ni `formaterQuantite` (unites g/ml/piece)
 * ni `formaterEuros` ne conviennent a un simple compte : duplique volontairement
 * depuis `Recettes.tsx`, aucun calcul, uniquement une mise en forme d'un
 * nombre deja fourni par l'API.
 */
function formaterCrepes(valeur: number): string {
  const nombre = new Intl.NumberFormat('fr-BE').format(valeur);
  return `${nombre} ${Math.abs(valeur) <= 1 ? 'crêpe' : 'crêpes'}`;
}

const COLONNES_BESOINS: ReadonlyArray<ColonneTableau<BesoinIngredientContrat>> = [
  {
    cle: 'ingredient',
    libelle: 'Ingrédient',
    largeur: '34%',
    alignement: 'texte',
    rendu: (b) => b.nomIngredient,
    titre: (b) => b.nomIngredient,
  },
  {
    cle: 'requis',
    libelle: 'Requis',
    largeur: '20%',
    alignement: 'nombre',
    rendu: (b) => formaterQuantite(b.requis, b.unite),
  },
  {
    cle: 'disponible',
    libelle: 'Disponible',
    largeur: '20%',
    alignement: 'nombre',
    rendu: (b) => formaterQuantite(b.disponible, b.unite),
  },
  {
    cle: 'manquant',
    libelle: 'Manquant',
    largeur: '14%',
    alignement: 'nombre',
    rendu: (b) => formaterQuantite(b.manquant, b.unite),
  },
  {
    cle: 'statut',
    libelle: 'Statut',
    largeur: '12%',
    alignement: 'texte',
    rendu: (b) => (
      <PastilleStatut
        statut={statutBesoin(b)}
        libelle={statutBesoin(b) === 'depassement' ? 'Manque' : 'OK'}
      />
    ),
  },
];

/**
 * Ce tableau est rendu dans la fiche de détail DOCKÉE, large de 420 px
 * (`w-full lg:w-[26.25rem]`, FIXE dès `lg` — élargir la fenêtre ne change
 * rien) : ses colonnes se partagent ~418 px de contenu réel (mesuré au
 * navigateur : 420 px moins les 2×1 px de bordure du `Panneau`), jamais la
 * pleine largeur de la page. C'est le tableau le plus contraint du produit,
 * et c'est aussi celui qui porte la traçabilité — d'où deux `repli` plutôt
 * que des `titre` (l'infobulle native n'est pas exposée au clavier).
 *
 * LA COLONNE « RÉEL » EST RÉTABLIE (docs/17 fiche 9), ET C'ÉTAIT UNE CONDITION,
 * PAS UN CONFORT. Elle avait été retirée parce que `production_consommation.
 * quantite_reelle` restait `null` À VIE : une colonne qui ne peut jamais se
 * remplir est pire qu'une colonne absente. Le chemin qui manquait existe
 * maintenant dans `packages/db/src/services/production.ts` : la saisie du
 * réalisé peut déclarer un réel PAR INGRÉDIENT, qui devient un vrai MOUVEMENT
 * rattaché à la production (règle n°5).
 * Le réalisé GLOBAL — volume et crêpes — reste affiché juste en dessous.
 *
 * ═══ CINQ COLONNES, PAS SIX — LE COÛT EST FUSIONNÉ EN UNE SEULE ═══
 *
 * Mesuré au navigateur (`clientWidth`/`scrollWidth` de chaque `th`, aux trois
 * cibles 1280/1920/2560 — identique aux trois, ce panneau ne dépend PAS du
 * viewport) : avec un « Coût théo. » et un « Coût réel » séparés, les deux
 * en-têtes tronquaient en « COÛ… » et « COÛT … » — visuellement quasi
 * indiscernables, exactement l'opposition que ces deux colonnes existent
 * pour montrer. Élargir l'une aux dépens de l'autre ne change rien à la
 * confusion ; abréger davantage l'aggrave.
 *
 * La colonne « Coût » fusionne donc les deux valeurs dans UNE cellule
 * (« 3,46 / 4,39 », théorique puis réel — même ordre que les en-têtes qu'elle
 * remplace) plutôt que de les recouper en deux en-têtes qui se ressemblent.
 * Aucune couleur ni signe sur l'écart : docs/07 §4.5 interdit un signal porté
 * par la seule couleur (impression N&B chez le comptable/l'AFSCA,
 * daltonisme), et ces tableaux n'ont pas de canal redondant tout prêt pour un
 * écart de coût par ligne — en inventer un pour cette seule colonne aurait
 * été plus de mécanisme que l'information n'en demande. Les deux nombres,
 * l'un à côté de l'autre, suffisent à voir l'écart.
 *
 * Ce même défaut n'existe PAS entre « Théo. » et « Sorti » (quantité) : les
 * deux s'affichent en entier (aucune troncature mesurée), et les FUSIONNER
 * n'aurait rien libéré côté largeur — leurs en-têtes abrégés tenaient déjà en
 * ~112 px à eux deux, soit autant qu'une cellule fusionnée avec un contenu
 * variable (« 6 600 / 6 800 ml »). Les deux quantités ne sont donc PAS
 * fusionnées : `quantiteReelle` (DÉCLARÉE par le porteur pour l'ingrédient
 * entier) et `quantiteMouvementee` (ce que le GRAND LIVRE a enregistré sur CE
 * lot) restent deux colonnes distinctes, jamais interchangeables — voir
 * `schemaConsommationProduction` (`@batte/core`), qui porte la distinction. La
 * colonne de droite lit `quantiteMouvementee` et non `quantiteReelle` :
 * `quantiteReelle` reste `null` dès que la fournée a puisé dans plusieurs lots,
 * alors que le stock, lui, a bien enregistré une quantité — la ligne aurait
 * affiché « — » à côté d'un coût réel chiffré.
 *
 * ═══ « RÉEL » A CÉDÉ LA PLACE À « SORTI DU LOT » (01/08/2026) ═══
 *
 * Le champ s'appelait ici `quantiteReelleMouvementee` et, dans les contrats
 * AFSCA, `quantiteMouvementee` — deux noms pour UNE grandeur, sous deux
 * en-têtes : « Réel » ici, « Sorti du lot » au registre et sur la fiche de
 * rappel. C'est ce qui fait qu'un correctif s'applique d'un côté et pas de
 * l'autre. Le nom ET l'en-tête sont unifiés sur la formulation du registre :
 * « Réel » ne disait que ce que le chiffre N'EST PAS (ni théorique, ni
 * déclaré), « Sorti du lot » dit ce qu'il EST.
 *
 * L'EN-TÊTE EST ABRÉGÉ EN « Sorti » DANS CE PANNEAU-CI, et c'est une
 * ABRÉVIATION CHOISIE (docs/07 §4.5), pas une troncature subie — exactement le
 * traitement que ce même tableau applique déjà à `quantiteTheorique`, qui
 * s'écrit « Théorique » dans le registre (panneau large) et « Théo. » ici.
 * MESURÉ, pas estimé (Segoe UI 11 px, 600, capitales, `letter-spacing` 0,3 px,
 * plus les 2 × 12 px de `--spacing-cellule-x`) : « SORTI DU LOT » réclame
 * 98 px quand cette colonne en offre 63 (15 % de ~418 px utiles), et les
 * quatre autres colonnes ne totalisent qu'une dizaine de pixels de marge —
 * l'en-tête serait donc coupé par l'ellipse de `index.css`, qui frappe les
 * `<th>` quoi qu'on déclare en `troncature`. « SORTI » tient en 55 px. Le
 * libellé entier reste porté par `libelleLong`, en infobulle d'en-tête.
 * Contrôle de méthode : la même mesure rend 32 px pour « THÉO. » seul, la
 * valeur déjà relevée au navigateur pour cette colonne.
 *
 * La largeur libérée par la fusion des deux colonnes de coût va à
 * « Ingrédient » (le seul en-tête qui manquait de 2 px) et à
 * « Lot fournisseur » — abrégé en « Lot fourn. » (le mot entier reste en
 * infobulle, `libelleLong`, docs/07 §4.5) — qui manquait de 48 px (39 % de sa
 * largeur), et c'est LA colonne du rappel sanitaire (CLAUDE.md §3 règle 6).
 */
export const COLONNES_CONSOMMATIONS: ReadonlyArray<ColonneTableau<ConsommationProduction>> = [
  {
    cle: 'ingredient',
    libelle: 'Ingrédient',
    // 23 % de ~418 px utiles ≈ 96 px, pour 94 px requis (mesuré au
    // navigateur, en-tête compris — contre 92 px avant cette mission, d'où
    // les 2 px qui manquaient) : « Farine de froment T55 » et
    // « Farine de froment T65 » ne s'y coupent toujours pas, le `repli` les
    // enroule. Le grade de la farine est en FIN de chaîne et c'est lui qui
    // distingue les deux ingrédients — donc la ligne de consommation qu'on
    // est en train de lire.
    largeur: '23%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (c) => c.nomIngredient,
  },
  {
    cle: 'lot',
    // ABRÉVIATION CHOISIE (docs/07 §4.5), pas une troncature CSS : l'en-tête
    // complet mesurait 123 px requis pour 75 px disponibles (48 px, 39 % de
    // déficit) — le plus grand des six mesurés. `libelleLong` restitue le mot
    // entier en infobulle d'en-tête ; ce n'est PAS ce qui rend le contenu de
    // la colonne accessible (voir `troncature: 'repli'` juste en dessous).
    libelle: 'Lot fourn.',
    libelleLong: 'Numéro de lot fournisseur',
    // 22 % ≈ 92 px, pour 88 px requis avec l'abréviation ci-dessus (contre
    // 75 px disponibles avant cette mission, pour 123 px requis SANS
    // abréviation — le déficit le plus grand des six colonnes mesurées).
    largeur: '22%',
    alignement: 'texte',
    // LE champ qui sert à rappeler une marchandise (CLAUDE.md §3 règle 6). Les
    // numéros d'un même fournisseur partagent leur préfixe et ne diffèrent que
    // par la fin : « LOT-2026-0731-A » et « LOT-2026-0731-B » deviennent la
    // même chaîne à l'écran si l'ellipse les coupe. Le `titre` qui tenait lieu
    // de recours n'en est pas un : l'infobulle native n'est pas exposée au
    // clavier (CLAUDE.md §3 règle 10). Obligation AFSCA, pas préférence
    // visuelle — exactement le traitement déjà appliqué à la même colonne
    // dans `RegistreAfsca.tsx`.
    troncature: 'repli',
    rendu: (c) => ouTiret(c.numeroLotFournisseur, (n) => n),
  },
  {
    cle: 'theorique',
    // ABRÉVIATION CHOISIE plutôt que troncature CSS (docs/07 §4.5) : « Théorique »
    // serait coupé par l'ellipse, et l'ellipse coupe où elle veut selon la
    // largeur du navigateur. `libelleLong` porte le mot entier en infobulle
    // d'en-tête. En-tête et cellule s'affichent déjà en ENTIER aux trois
    // largeurs mesurées (1280/1920/2560, ce panneau ne dépend pas du
    // viewport) : rien à fusionner ici, voir l'en-tête de ce tableau.
    //
    // 15 % ≈ 63 px. Ce n'est PAS l'en-tête qui commande cette largeur (32 px
    // suffiraient) mais la CELLULE : une quantité à deux décimales après
    // conversion en kg/L (« 1,5 kg ») demande 58-59 px mesurés une fois le
    // rembourrage de colonne compté — c'est elle qui a débordé de 5 px avant
    // cet ajustement, invisible à l'œil mais réel au `scrollWidth`.
    libelle: 'Théo.',
    libelleLong: 'Quantité théorique prévue par la recette sur ce lot',
    largeur: '15%',
    alignement: 'nombre',
    rendu: (c) => formaterQuantite(c.quantiteTheorique, c.unite),
  },
  {
    // REMPLACE « Réel » le 01/08/2026 — voir le bloc « RÉEL A CÉDÉ LA PLACE À
    // SORTI DU LOT » en tête de ce tableau, qui porte la mesure de largeur et
    // le motif de l'abréviation.
    cle: 'sorti',
    libelle: 'Sorti',
    libelleLong:
      'Sorti du lot : quantité réellement mouvementée sur ce lot (sorties − restitutions)',
    // Même besoin que « Théo. » ci-dessus, même largeur : la cellule, pas
    // l'en-tête, est ce qui commande les 15 % (« SORTI » réclame 55 px, la
    // cellule « 1,5 kg » 58-59).
    largeur: '15%',
    alignement: 'nombre',
    // `0` ≠ `—` (doctrine design) : une quantité intégralement restituée est
    // une information, l'absence de toute mesure du réel en est une autre.
    // `quantiteMouvementee` et NON `quantiteReelle` — voir l'en-tête de ce
    // tableau : c'est ce qui met sur la même ligne la quantité et le coût qui
    // en découle.
    rendu: (c) => ouTiret(c.quantiteMouvementee, (q) => formaterQuantite(q, c.unite)),
  },
  {
    // FUSIONNÉE (voir l'en-tête de ce tableau) : une seule colonne « Coût »,
    // theo/réel côte à côte dans la même cellule, plutôt que deux en-têtes
    // qui tronquaient en « COÛ… » / « COÛT … » — indiscernables l'un de
    // l'autre, l'exact opposé de ce que ces deux colonnes existent pour
    // montrer.
    cle: 'cout',
    libelle: 'Coût',
    libelleLong:
      'Coût théorique (€, figé au lancement) / coût réel (€, dérivé des mouvements de stock de cette production)',
    // 25 % ≈ 105 px. Contenu variable (deux montants) : c'est la seule
    // colonne de ce tableau dont la largeur nécessaire dépend de la donnée,
    // pas seulement de l'en-tête — d'où la marge la plus généreuse des cinq.
    largeur: '25%',
    alignement: 'nombre',
    // Jamais de couleur ni de signe sur l'écart (docs/07 §4.5 : un signal ne
    // se porte jamais par la seule couleur — impression N&B chez le
    // comptable/l'AFSCA, daltonisme) : les deux montants, l'un à côté de
    // l'autre, disent déjà l'écart.
    //
    // `coutCents` n'est JAMAIS `null` (écrit au lancement, il existe
    // toujours) ; `coutReelCents` distingue `—` (pas encore mesuré, réalisé
    // non saisi) de `0,00` (VRAI zéro : la matière prise sur ce lot a été
    // intégralement restituée). Les confondre afficherait une matière
    // gratuite, donc 100 % de marge — le mensonge le plus traqué du dépôt
    // (CLAUDE.md §7).
    rendu: (c) => `${formaterMontant(c.coutCents)} / ${ouTiret(c.coutReelCents, formaterMontant)}`,
  },
];

/**
 * Fonction plutot que constante DEPUIS le correctif « brief vs ecrans »
 * (01/08/2026) : la colonne `dlc` a besoin de l'horizon d'alerte DLC, chargé
 * de manière asynchrone depuis `brief_horizon_alerte_dlc_jours` — il ne peut
 * plus s'agir d'un simple littéral figé au chargement du module. Les largeurs
 * de colonnes, elles, ne dépendent d'aucun argument : `colonnesHistorique(null)`
 * suffit à qui n'a besoin que de vérifier `largeur` (voir `Production.test.tsx`).
 */
export function colonnesHistorique(
  horizonDlcJours: number | null,
): ReadonlyArray<ColonneTableau<ProductionResume>> {
  return [
    {
      cle: 'numero',
      libelle: 'Numéro',
      largeur: '12%',
      alignement: 'texte',
      rendu: (p) => <span className="font-mono text-xs">{p.numero}</span>,
      titre: (p) => p.numero,
    },
    {
      // 11 % : mesuré à 1280 px CSS effectifs (`canvas.measureText`, police et
      // interlettrage réels), « 25/07/2026 » a besoin de 94 px, cette largeur
      // en donne 111 — marge conservée après le point suivant.
      cle: 'date',
      libelle: 'Date',
      largeur: '11%',
      alignement: 'texte',
      rendu: (p) => formaterDate(p.dateProduction),
    },
    {
      // `repli`, jamais l'ellipse (correction du 31/07/2026, garde automatique
      // D-081 + mesure au clavier) : `recetteNom` n'est PAS borné — R1 rend
      // « R1 — Pâte à crêpes froment » (190 px, mesuré), R2 rend « R2 — Pâte à
      // crêpes sarrasin-châtaigne (sans gluten) » (≈ 373 px). AUCUNE largeur
      // raisonnable dans ce tableau ne peut accueillir les deux sur une seule
      // ligne : élargir pour R2 aurait affamé les six autres colonnes pour un
      // gain qui ne sert que la moitié des productions. `troncature: 'repli'`
      // laisse R1 tenir sur ~2 lignes et R2 sur ~3-4 — la rangée grandit
      // seulement pour les productions qui en ont réellement besoin (docs/07
      // §4.5), et surtout la mention « sans gluten » ne disparaît plus jamais
      // dans une ellipse alors que c'est justement ce qui distingue les deux
      // recettes pour l'allergène.
      cle: 'recette',
      libelle: 'Recette',
      largeur: '12%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (p) => `${p.recetteCode} — ${p.recetteNom}`,
      titre: (p) => `${p.recetteCode} — ${p.recetteNom}`,
    },
    {
      // 9 % : le contenu (ex. « 10,4 L ») est court et borné, l'ellipse ne
      // mord jamais dessus (mesuré : 70 px requis pour 91 px disponibles).
      cle: 'volume',
      libelle: 'Volume',
      largeur: '9%',
      alignement: 'nombre',
      rendu: (p) => formaterQuantite(p.volumeReelMl ?? p.volumeTheoriqueMl, 'ml'),
      // L'infobulle DOIT commencer par ce que la cellule affiche (contrat de
      // `ColonneTableau.titre`). Elle ouvrait sur le volume THÉORIQUE alors que
      // la cellule montre le RÉEL dès qu'il est saisi : survoler répondait à
      // côté, et les deux nombres diffèrent précisément quand il y a un écart de
      // rendement — le seul cas où l'on survole.
      titre: (p) =>
        p.volumeReelMl !== null
          ? `Réel ${formaterQuantite(p.volumeReelMl, 'ml')} · théorique ${formaterQuantite(p.volumeTheoriqueMl, 'ml')}`
          : `Théorique ${formaterQuantite(p.volumeTheoriqueMl, 'ml')} — réel non saisi`,
    },
    {
      cle: 'statut',
      libelle: 'Statut',
      // 11 % : le statut est BORNÉ — trois libellés courts (« En cours »,
      // « Terminée », « Annulée ») — 87 px requis glyphe compris, pour 111 px
      // disponibles. Il cède sa largeur sans rien perdre, ce que docs/07 §4.5
      // demande précisément d'une colonne bornée face à une colonne qui déborde.
      largeur: '11%',
      alignement: 'texte',
      rendu: (p) => (
        <PastilleStatut
          statut={statutAffichageProduction(p.statut)}
          libelle={LIBELLE_STATUT_PRODUCTION[p.statut]}
        />
      ),
    },
    {
      // `repli`, jamais l'ellipse (correction du 31/07/2026) : LE champ qui sert
      // à rappeler une marchandise (CLAUDE.md §3 règle 6), exactement le
      // traitement déjà appliqué à la même colonne dans `COLONNES_CONSOMMATIONS`
      // ci-dessus et dans `RegistreAfsca.tsx`. `titre` reste posé en confort
      // souris, mais ce n'est pas lui qui rend le numéro accessible au clavier.
      cle: 'lotPate',
      libelle: 'Lot de pâte',
      largeur: '14%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (p) => <span className="font-mono text-xs">{p.numeroLotPate}</span>,
      titre: (p) => p.numeroLotPate,
    },
    {
      cle: 'dlc',
      libelle: 'DLC pâte',
      // 17 % — INCHANGÉ, mesuré à 1280 px : « 28/07/2026 aujourd'hui » déborde
      // en dessous de 17 %, et c'est le COMPTEUR qui saute — or le compteur est
      // ce qui rend la DLC actionnable d'un coup d'œil. Ne pas céder ces points.
      largeur: '17%',
      alignement: 'texte',
      rendu: (p) => rendreDlcPate(p.dateDlcPate, horizonDlcJours),
      // La cellule rend « 28/07/2026 aujourd'hui » : c'est le COMPTEUR qui se
      // fait couper en premier à 14 % de large (mesuré : 31 px de débordement),
      // et l'infobulle ne restituait que la date — donc strictement moins que la
      // cellule. Une infobulle moins informative que ce qu'elle explique ne sert
      // à rien. `libelleDlcPate` produit la même chaîne que le rendu.
      titre: (p) => libelleDlcPate(p.dateDlcPate, horizonDlcJours),
    },
    {
      /**
       * C'EST LA COLONNE QUI CORRIGE G1/G4 (docs/14) : `production.session_id`
       * pouvait rester NUL indéfiniment, sans qu'aucun écran ne le montre — un
       * coût matière disparaissait silencieusement de la marge de session, et
       * la traçabilité aval affichait `—` sur une question de rappel AFSCA.
       * Une simple pastille suffit (l'énoncé le demande explicitement : « pas
       * un tableau de bord ») : le numéro de session s'il y en a une, une
       * alerte visible sinon — jamais un tiret muet qui se confondrait avec
       * une absence de données normale ailleurs dans ce même tableau.
       *
       * 14 % : mesuré à 1280 px, « SM-2026-0002 » a besoin de 117 px — 11 %
       * (111 px, valeur d'avant cette mission) le tronquait de 3 px, invisible
       * à l'œil mais bien réel au `scrollWidth`.
       */
      cle: 'session',
      libelle: 'Session',
      largeur: '14%',
      alignement: 'texte',
      rendu: (p) =>
        p.sessionNumero !== null && p.sessionNumero !== undefined ? (
          <span className="font-mono text-xs">{p.sessionNumero}</span>
        ) : (
          <PastilleStatut statut="alerte" libelle="À rattacher" />
        ),
      titre: (p) =>
        p.sessionNumero !== null && p.sessionNumero !== undefined
          ? `Rattachée à la session ${p.sessionNumero}`
          : "Aucune session rattachée : son coût matière n'entre dans aucune marge de session.",
    },
  ];
}

export default function Production() {
  const navigate = useNavigate();

  // ─── Recettes (référentiel) ──────────────────────────────────────────────
  const [etatRecettes, setEtatRecettes] = useState<EtatRecettesEcran>({ statut: 'chargement' });
  const [recetteId, setRecetteId] = useState<string | null>(null);

  // ─── Sessions (docs/14 G1/G4) ────────────────────────────────────────────
  const [etatSessions, setEtatSessions] = useState<EtatSessionsEcran>({ statut: 'chargement' });

  // ─── Previsions archivees (docs/03, D-058) ───────────────────────────────
  const [etatPrevisions, setEtatPrevisions] = useState<EtatPrevisionsEcran>({
    statut: 'chargement',
  });

  // ─── Formulaire de nouvel ordre ──────────────────────────────────────────
  const [cibleType, setCibleType] = useState<TypeCibleProduction>('volume');
  const [valeurSaisie, setValeurSaisie] = useState<string>('');
  const [erreurValeur, setErreurValeur] = useState<string | null>(null);
  const [dateProduction, setDateProduction] = useState<string>(aujourdHui);
  const [erreurDate, setErreurDate] = useState<string | null>(null);
  const [notesSaisie, setNotesSaisie] = useState<string>('');
  // '' = pâte pas encore destinée à un marché (cas courant : on lance avant
  // que la session n'existe). Le rattachement après coup est le SECOND geste
  // demandé par docs/14 G1/G4, tout aussi nécessaire que celui-ci.
  const [sessionIdSaisie, setSessionIdSaisie] = useState<string>('');
  const [etatFaisabilite, setEtatFaisabilite] = useState<EtatFaisabiliteEcran | null>(null);
  const [etatLancement, setEtatLancement] = useState<EtatEcritureEcran>({ statut: 'inactif' });

  // ─── Historique + détail ─────────────────────────────────────────────────
  const [etatHistorique, setEtatHistorique] = useState<EtatHistoriqueEcran>({
    statut: 'chargement',
  });
  const [productionSelectionneeId, setProductionSelectionneeId] = useState<string | null>(null);
  const [etatDetail, setEtatDetail] = useState<EtatDetailEcran | null>(null);

  // ─── Saisie du réalisé (dans le panneau de détail) ──────────────────────
  const [volumeReelSaisi, setVolumeReelSaisi] = useState<string>('');
  const [crepesReellesSaisi, setCrepesReellesSaisi] = useState<string>('');
  const [motifRealiseSaisi, setMotifRealiseSaisi] = useState<string>('');
  const [etatRealise, setEtatRealise] = useState<EtatEcritureEcran>({ statut: 'inactif' });
  /**
   * Consommation RÉELLE par ingrédient (docs/17 fiche 9), clé = `ingredientId`.
   * Optionnelle et partielle : une entrée vide signifie « non déclaré », pas
   * zéro — laissée à `''` par défaut, jamais pré-remplie (même principe que le
   * champ température de `RegistreAfsca.tsx` : un champ pré-rempli se valide
   * sans être lu).
   */
  const [consommationsReellesSaisies, setConsommationsReellesSaisies] = useState<
    Record<string, string>
  >({});

  // ─── Rattachement à une session, APRÈS coup (dans le panneau de détail) ──
  // C'est le geste qui manquait : docs/14 G1/G4 constate qu'on ne peut choisir
  // une session QU'AU lancement, jamais la corriger ensuite — or on lance
  // souvent la pâte avant que la session du marché n'existe encore.
  const [sessionIdRattachement, setSessionIdRattachement] = useState<string>('');
  const [etatRattachement, setEtatRattachement] = useState<EtatEcritureEcran>({
    statut: 'inactif',
  });

  /**
   * ─── Annulation de la production (D-087) ────────────────────────────────
   *
   * `POST /productions/:id/annuler` existait depuis l'audit du 29/07/2026 —
   * service, contrepassation de TOUS les mouvements rattachés, motif
   * obligatoire, tests — et aucun écran ne l'appelait : une production lancée
   * par erreur restait définitivement engagée, stock consommé compris. C'est
   * l'une des deux seules écritures qui touchent des LOTS, donc l'une des deux
   * dont l'erreur remonte au registre AFSCA.
   */
  const [annulationOuverte, setAnnulationOuverte] = useState(false);
  const [motifAnnulation, setMotifAnnulation] = useState('');
  const [erreursAnnulation, setErreursAnnulation] = useState<ErreursFormulaire>(AUCUNE_ERREUR);
  const [annulationEnCours, setAnnulationEnCours] = useState(false);
  /**
   * Confirmation d'annulation, PERSISTANTE tant qu'on n'a pas changé de
   * production — écart assumé à docs/07 §4.7 (« succès : 5 s »), le même que
   * celui de la confirmation de réception : le bloc juste au-dessus n'affiche
   * plus qu'une raison de refus une fois l'annulation faite, et une
   * confirmation qui s'efface laisserait un panneau muet devant un geste qui
   * touche le registre AFSCA.
   */
  const [messageAnnulation, setMessageAnnulation] = useState<string | null>(null);
  /**
   * D-079 (complément du 31/07/2026) : `disabled` posé sur un bouton qui a le
   * focus le lui fait lâcher par le navigateur, avant tout rendu React — le
   * nœud survit, il devient seulement inéligible. Ces trois `ref` sont ce qui
   * permet de le lui rendre, ou de désigner la suite du geste.
   */
  const boutonOuvrirAnnulationRef = useRef<HTMLButtonElement>(null);
  const boutonConfirmerAnnulationRef = useRef<HTMLButtonElement>(null);
  const boutonFermerDetailRef = useRef<HTMLButtonElement>(null);
  /**
   * Conteneur de l'historique (panneau de GAUCHE, jamais démonté quand le
   * détail se ferme) : c'est là que le focus doit revenir à la fermeture DU
   * PANNEAU LUI-MÊME, normale (bouton « Fermer ») ou par Échap — jamais sur
   * `<body>`, qui obligerait à retraverser toute la navigation pour revenir
   * où l'on était. Différent des trois `ref` ci-dessus : celles-là visent un
   * bouton qui RESTE monté après l'action (le panneau reste ouvert) ; ici
   * c'est le panneau entier qui disparaît, donc la cible doit vivre EN DEHORS
   * de lui.
   */
  const panneauHistoriqueRef = useRef<HTMLDivElement>(null);

  /**
   * FERME le panneau de détail — bouton « Fermer » ou Échap — en rendant le
   * focus à la rangée d'historique qui l'avait ouvert, jamais à `<body>`
   * (défaut réel corrigé ici : les deux chemins de fermeture laissaient
   * tomber le focus, ce qui obligeait à retraverser toute la navigation pour
   * revenir à l'historique).
   *
   * La rangée est capturée AVANT l'écriture d'état, tant que `aria-selected`
   * la désigne encore : `Tableau.tsx` réutilise le même nœud DOM d'un rendu à
   * l'autre (clé React stable sur `p.id`), donc ce nœud reste valide après la
   * fermeture — seul le panneau de droite se démonte, jamais l'historique.
   * Repli sur le conteneur de l'historique si la rangée n'est, pour une
   * raison quelconque, pas retrouvée : mieux vaut un focus imprécis qu'un
   * focus perdu.
   *
   * `useCallback([])` : référence STABLE d'un rendu à l'autre — seuls des
   * `ref` (jamais réactifs) et le `setState` de `productionSelectionneeId`
   * (stable par construction React) sont utilisés à l'intérieur. Nécessaire
   * pour que l'effet Échap plus bas puisse la lister dans ses dépendances
   * sans se réabonner à chaque rendu.
   */
  const fermerDetailProduction = useCallback((): void => {
    const conteneur = panneauHistoriqueRef.current;
    const rangeeCourante =
      conteneur?.querySelector<HTMLElement>('tr[aria-selected="true"]') ?? null;
    setProductionSelectionneeId(null);
    requestAnimationFrame(() => {
      if (rangeeCourante !== null) rangeeCourante.focus();
      else conteneur?.focus();
    });
  }, []);

  /**
   * Horizon d'alerte DLC (colonne « DLC pâte » de l'historique), lu depuis
   * `brief_horizon_alerte_dlc_jours` — voir le commentaire de `rendreDlcPate`.
   * Correctif « brief vs ecrans » (01/08/2026, docs/29-VALEURS-EN-DUR.md §4).
   */
  const [horizonDlcJours, setHorizonDlcJours] = useState<number | null>(null);

  useEffect(() => {
    let annule = false;

    requeteApi<unknown>('/parametres')
      .then((reponse) => {
        if (annule) return;
        const liste = schemaListeParametres.parse(reponse);
        const valeur = valeurEntiereParametre(
          liste.data,
          'brief_horizon_alerte_dlc_jours',
          aujourdHui(),
        );
        if (valeur !== null) setHorizonDlcJours(valeur);
      })
      .catch(() => {
        // Confort d'affichage, jamais une dependance (CLAUDE.md §5) : sans ce
        // parametre, `rendreDlcPate` continue de montrer la date, seul le
        // compteur « J-n »/« aujourd'hui » reste absent.
      });

    return () => {
      annule = true;
    };
  }, []);

  // Chargement des recettes au montage, et selection automatique de la
  // premiere recette ACTIVE : seules celles-ci sont produisibles (l'enonce
  // le demande explicitement — une recette `brouillon` ou `archivee` n'a pas
  // de sens a produire).
  useEffect(() => {
    let annule = false;

    requeteApi<unknown>('/recettes')
      .then((reponse) => {
        const liste = schemaListeRecettes.parse(reponse);
        if (annule) return;
        setEtatRecettes({ statut: 'pret', recettes: liste.data });
        const premiereActive = liste.data.find((r) => r.statut === 'active') ?? null;
        if (premiereActive !== null) setRecetteId(premiereActive.id);
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatRecettes({ statut: 'erreur', message });
      });

    return () => {
      annule = true;
    };
  }, []);

  // Chargement des sessions au montage (docs/14 G1/G4) : la même liste sert
  // au rattachement au lancement ET après coup.
  useEffect(() => {
    let annule = false;

    requeteApi<unknown>('/sessions')
      .then((reponse) => {
        const liste = schemaListeSessions.parse(reponse);
        if (!annule) setEtatSessions({ statut: 'pret', sessions: liste.data });
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatSessions({ statut: 'erreur', message });
      });

    return () => {
      annule = true;
    };
  }, []);

  // Chargement des previsions archivees au montage (docs/03, D-058) : sert a
  // retrouver, pour la session choisie dans le formulaire, la prevision qui
  // a motive ce lancement — voir `previsionRetenue` plus bas. `GET
  // /previsions` rend deja la liste triee de la plus recente a la plus
  // ancienne (`listerPrevisions`), ordre dont `previsionRetenue` depend.
  useEffect(() => {
    let annule = false;

    requeteApi<unknown>('/previsions')
      .then((reponse) => {
        const liste = schemaListePrevisions.parse(reponse);
        if (!annule) setEtatPrevisions({ statut: 'pret', previsions: liste.data });
      })
      .catch(() => {
        // L'IA/le modele est un confort, jamais une dependance (CLAUDE.md §5) :
        // une prevision indisponible ne bloque ni n'alerte, elle laisse
        // simplement `previsionRetenue` a `null` plus bas.
        if (!annule) setEtatPrevisions({ statut: 'erreur' });
      });

    return () => {
      annule = true;
    };
  }, []);

  // Reinitialise le formulaire sur des valeurs REELLES de la recette
  // choisie (rendement de reference en volume) a chaque changement de
  // selection — meme logique que l'effet de detail de `Recettes.tsx`.
  useEffect(() => {
    if (recetteId === null || etatRecettes.statut !== 'pret') return;
    const recette = etatRecettes.recettes.find((r) => r.id === recetteId);
    if (recette === undefined) return;
    setCibleType('volume');
    setValeurSaisie(String(recette.rendementReferenceMl));
  }, [recetteId, etatRecettes]);

  // Controle de faisabilite EN DIRECT : debounce de 300 ms apres la saisie.
  // Les erreurs de saisie (valeur, date) s'affichent IMMEDIATEMENT, sans
  // attendre le debounce — seul l'appel reseau est retarde.
  useEffect(() => {
    if (recetteId === null) {
      setEtatFaisabilite(null);
      return;
    }

    const valeur = parserEntierPositif(valeurSaisie);
    if (valeur === null) {
      setErreurValeur(messageErreurValeur(cibleType));
      setEtatFaisabilite(null);
      return;
    }
    setErreurValeur(null);

    if (dateProduction === '') {
      setErreurDate('La date de production est obligatoire.');
      setEtatFaisabilite(null);
      return;
    }
    setErreurDate(null);

    const cible: CibleProduction =
      cibleType === 'crepes' ? { cible: 'crepes', valeur } : { cible: 'volume', valeur };
    const corps = { recetteId, cible, dateProduction };

    let annule = false;
    const minuteur = window.setTimeout(() => {
      setEtatFaisabilite({ statut: 'chargement' });
      requeteApi<unknown>('/productions/faisabilite', {
        method: 'POST',
        body: JSON.stringify(corps),
      })
        .then((reponse) => {
          const resultat = schemaFaisabilite.parse(reponse);
          if (!annule) setEtatFaisabilite({ statut: 'pret', resultat });
        })
        .catch((erreur: unknown) => {
          if (annule) return;
          const message =
            erreur instanceof ErreurApi
              ? erreur.message
              : 'Erreur inattendue, sans plus de détail.';
          setEtatFaisabilite({ statut: 'erreur', message });
        });
    }, DELAI_DEBOUNCE_MS);

    return () => {
      annule = true;
      window.clearTimeout(minuteur);
    };
  }, [recetteId, cibleType, valeurSaisie, dateProduction]);

  // Chargement de l'historique au montage.
  useEffect(() => {
    let annule = false;

    requeteApi<unknown>('/productions')
      .then((reponse) => {
        const liste = schemaListeProductions.parse(reponse);
        if (!annule)
          setEtatHistorique({ statut: 'pret', productions: liste.data, total: liste.meta.total });
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatHistorique({ statut: 'erreur', message });
      });

    return () => {
      annule = true;
    };
  }, []);

  // Detail de la production selectionnee, avec ses consommations lot par lot
  // — la tracabilite exigee par l'enonce. Meme patron que le detail des lots
  // de `Stock.tsx`.
  useEffect(() => {
    if (productionSelectionneeId === null) {
      setEtatDetail(null);
      return;
    }

    let annule = false;
    setEtatDetail({ statut: 'chargement' });

    requeteApi<unknown>(`/productions/${productionSelectionneeId}`)
      .then((reponse) => {
        const detail = schemaProductionDetail.parse(reponse);
        if (annule) return;
        setEtatDetail({ statut: 'pret', detail });
        // Le realise se saisit a partir du theorique (point de depart
        // vraisemblable, jamais invente) ; le motif reste VIERGE — celui
        // saisi a la creation repond a une question differente (ecart par
        // rapport a un ordre suggere) de celui du realise (ecart de
        // consommation constate), voir le rapport de livraison.
        setVolumeReelSaisi(String(detail.volumeReelMl ?? detail.volumeTheoriqueMl));
        setCrepesReellesSaisi(String(detail.crepesReelles ?? detail.crepesTheoriques));
        setMotifRealiseSaisi('');
        // Toujours vide au chargement, JAMAIS pré-rempli depuis le théorique :
        // une valeur par défaut ici se validerait sans être mesurée, exactement
        // ce que la fiche 9 reproche à la colonne « Réel » d'alors, celle qui
        // lisait `quantiteReelle` (à ne pas confondre avec la colonne « Sorti »
        // d'aujourd'hui, qui lit le grand livre et ne devine rien).
        setConsommationsReellesSaisies({});
        setEtatRealise({ statut: 'inactif' });
        // Point de depart REEL (jamais devine) : la session deja rattachee,
        // ou '' si aucune — meme logique que le realise juste au-dessus.
        setSessionIdRattachement(detail.sessionId ?? '');
        setEtatRattachement({ statut: 'inactif' });
        // Changer de production referme le bloc d'annulation : le laisser
        // ouvert sur une production qu'on vient de quitter est exactement le
        // geste qu'on cherche à rendre impossible (même précaution que
        // `<DetailLot>` au changement de lot).
        setAnnulationOuverte(false);
        setMotifAnnulation('');
        setErreursAnnulation(AUCUNE_ERREUR);
        setMessageAnnulation(null);
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatDetail({ statut: 'erreur', message });
      });

    return () => {
      annule = true;
    };
  }, [productionSelectionneeId]);

  // « Échap ferme » (docs/07 §4.6). `fermerDetailProduction` rend aussi le
  // focus à la rangée d'historique — jamais à `<body>`, voir sa définition.
  useEffect(() => {
    if (productionSelectionneeId === null) return;

    function surAppuiTouche(evenement: KeyboardEvent): void {
      if (evenement.key === 'Escape') fermerDetailProduction();
    }

    window.addEventListener('keydown', surAppuiTouche);
    return () => window.removeEventListener('keydown', surAppuiTouche);
  }, [productionSelectionneeId, fermerDetailProduction]);

  // Succes transitoire : 5 s puis retour a l'etat inactif (docs/07 §4.7).
  // L'erreur, elle, reste affichee jusqu'a la prochaine tentative.
  useEffect(() => {
    if (etatLancement.statut !== 'succes') return;
    const minuteur = window.setTimeout(() => setEtatLancement({ statut: 'inactif' }), 5000);
    return () => window.clearTimeout(minuteur);
  }, [etatLancement]);

  useEffect(() => {
    if (etatRealise.statut !== 'succes') return;
    const minuteur = window.setTimeout(() => setEtatRealise({ statut: 'inactif' }), 5000);
    return () => window.clearTimeout(minuteur);
  }, [etatRealise]);

  useEffect(() => {
    if (etatRattachement.statut !== 'succes') return;
    const minuteur = window.setTimeout(() => setEtatRattachement({ statut: 'inactif' }), 5000);
    return () => window.clearTimeout(minuteur);
  }, [etatRattachement]);

  function choisirCibleType(recette: RecetteResume, nouveau: TypeCibleProduction): void {
    setCibleType(nouveau);
    setValeurSaisie(String(valeurReference(recette, nouveau)));
  }

  /** Bascule directe sur le volume maximal realisable renvoye par l'API
   * (docs/07 §6.3) : aucune arithmetique, seulement la reprise d'un nombre
   * deja calcule cote serveur. */
  function basculerSurVolumeMaximal(volumeMaximalMl: number): void {
    setCibleType('volume');
    setValeurSaisie(String(volumeMaximalMl));
  }

  function selectionnerProduction(p: ProductionResume): void {
    setProductionSelectionneeId((precedent) => (precedent === p.id ? null : p.id));
  }

  async function lancerProduction(): Promise<void> {
    if (recetteId === null) return;
    const valeur = parserEntierPositif(valeurSaisie);
    if (valeur === null || dateProduction === '') return;
    if (
      etatFaisabilite === null ||
      etatFaisabilite.statut !== 'pret' ||
      !etatFaisabilite.resultat.faisable
    )
      return;
    if (etatLancement.statut === 'en_cours') return;

    const cible: CibleProduction =
      cibleType === 'crepes' ? { cible: 'crepes', valeur } : { cible: 'volume', valeur };
    const corps = {
      recetteId,
      cible,
      dateProduction,
      notes: notesSaisie.trim() === '' ? null : notesSaisie.trim(),
      // Rattachement DÈS LE LANCEMENT (docs/14 G1/G4, premier des deux
      // gestes demandés) : '' = pâte pas encore destinée à un marché, le cas
      // le plus courant — rattachable après coup dans le panneau de détail.
      sessionId: sessionIdSaisie === '' ? null : sessionIdSaisie,
      // Prévision retenue (docs/03, D-058) : EXACTEMENT celle affichée
      // ci-dessus au moment du clic, jamais recalculée ni redevinée côté
      // serveur. `null` si aucune session n'est choisie ou qu'aucune
      // prévision n'a été archivée pour elle — une fournée décidée sans
      // prévision, cas normal.
      previsionId: previsionRetenue?.id ?? null,
    };

    setEtatLancement({ statut: 'en_cours' });
    try {
      // Ecriture ATOMIQUE et irreversible cote stock (consommation FEFO) :
      // aucun affichage optimiste, on attend la reponse du serveur avant
      // toute mise a jour d'ecran (docs/07 §4.7).
      const reponse = await requeteApi<unknown>('/productions', {
        method: 'POST',
        body: JSON.stringify(corps),
      });
      const detail = schemaProductionDetail.parse(reponse);

      setEtatHistorique((precedent) =>
        precedent.statut === 'pret'
          ? {
              statut: 'pret',
              productions: [detail, ...precedent.productions],
              total: precedent.total + 1,
            }
          : precedent,
      );
      setProductionSelectionneeId(detail.id);
      setNotesSaisie('');
      setSessionIdSaisie('');
      setEtatLancement({ statut: 'succes', message: `Production ${detail.numero} lancée.` });
    } catch (erreur: unknown) {
      const message =
        erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
      setEtatLancement({ statut: 'erreur', message });
    }
  }

  async function enregistrerRealise(): Promise<void> {
    if (etatDetail === null || etatDetail.statut !== 'pret') return;
    const detail = etatDetail.detail;
    if (detail.statut !== 'lancee') return;

    const volumeReel = parserEntierNonNegatif(volumeReelSaisi);
    const crepesReelles = parserEntierNonNegatif(crepesReellesSaisi);
    if (volumeReel === null || crepesReelles === null) return;
    if (etatRealise.statut === 'en_cours') return;

    // Consommation réelle par ingrédient (docs/17 fiche 9) : optionnelle et
    // partielle, une entrée vide n'est PAS déclarée — jamais une valeur
    // devinée. Une saisie non vide invalide bloque déjà le bouton
    // (`peutEnregistrerRealise`) ; revérifié ici pour ne jamais envoyer une
    // valeur illisible au serveur.
    const consommationsReelles: { ingredientId: string; quantiteReelle: number }[] = [];
    for (const [ingredientId, saisie] of Object.entries(consommationsReellesSaisies)) {
      if (saisie.trim() === '') continue;
      const quantite = parserEntierNonNegatif(saisie);
      if (quantite === null) return;
      consommationsReelles.push({ ingredientId, quantiteReelle: quantite });
    }

    const corps = {
      volumeReelMl: volumeReel,
      crepesReelles,
      ecartMotif: motifRealiseSaisi.trim() === '' ? null : motifRealiseSaisi.trim(),
      consommationsReelles,
    };

    setEtatRealise({ statut: 'en_cours' });
    try {
      const reponse = await requeteApi<unknown>(`/productions/${detail.id}/realise`, {
        method: 'PATCH',
        body: JSON.stringify(corps),
      });
      const detailMisAJour = schemaProductionDetail.parse(reponse);

      setEtatDetail({ statut: 'pret', detail: detailMisAJour });
      setEtatHistorique((precedent) =>
        precedent.statut === 'pret'
          ? {
              statut: 'pret',
              productions: precedent.productions.map((p) =>
                p.id === detailMisAJour.id ? detailMisAJour : p,
              ),
              total: precedent.total,
            }
          : precedent,
      );
      setEtatRealise({
        statut: 'succes',
        message:
          consommationsReelles.length > 0
            ? `Réalisé enregistré — consommation réelle déclarée pour ${consommationsReelles.length} ` +
              `ingrédient${consommationsReelles.length > 1 ? 's' : ''}.`
            : 'Réalisé enregistré.',
      });
      /**
       * LE FOCUS VA SUR « Fermer » DU PANNEAU (D-079, complément du
       * 01/08/2026). La réponse fait passer la production à `terminee` : tout
       * le formulaire de saisie du réalisé — bouton « Enregistrer le réalisé »
       * compris — est démonté au même rendu. Sans cette reprise, le focus
       * retombe sur `<body>`, et l'utilisateur au clavier doit retraverser
       * toute la navigation.
       *
       * « Fermer » est le SEUL contrôle encore actionnable du panneau à cet
       * instant, exactement comme après une annulation (voir
       * `annulerLaProduction`) : ce n'est pas une cible inventée faute de
       * mieux, c'est la continuation naturelle du geste.
       */
      requestAnimationFrame(() => boutonFermerDetailRef.current?.focus());
    } catch (erreur: unknown) {
      const message =
        erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
      setEtatRealise({ statut: 'erreur', message });
    }
  }

  /**
   * Rattache, corrige, ou détache le rattachement d'une production à une
   * session — APRÈS son lancement (docs/14 G1/G4, second geste demandé).
   * `sessionIdRattachement === ''` détache : c'est un choix valide, pas une
   * saisie incomplète, donc aucune validation ne bloque l'envoi.
   */
  async function rattacherSessionProduction(): Promise<void> {
    if (etatDetail === null || etatDetail.statut !== 'pret') return;
    const detail = etatDetail.detail;
    if (etatRattachement.statut === 'en_cours') return;

    const nouveauSessionId = sessionIdRattachement === '' ? null : sessionIdRattachement;
    const corps = { sessionId: nouveauSessionId };

    setEtatRattachement({ statut: 'en_cours' });
    try {
      const reponse = await requeteApi<unknown>(`/productions/${detail.id}/session`, {
        method: 'PATCH',
        body: JSON.stringify(corps),
      });
      const detailMisAJour = schemaProductionDetail.parse(reponse);

      setEtatDetail({ statut: 'pret', detail: detailMisAJour });
      setEtatHistorique((precedent) =>
        precedent.statut === 'pret'
          ? {
              statut: 'pret',
              productions: precedent.productions.map((p) =>
                p.id === detailMisAJour.id ? detailMisAJour : p,
              ),
              total: precedent.total,
            }
          : precedent,
      );
      setEtatRattachement({
        statut: 'succes',
        message:
          detailMisAJour.sessionNumero !== null && detailMisAJour.sessionNumero !== undefined
            ? `Rattachée à la session ${detailMisAJour.sessionNumero}.`
            : 'Détachée de toute session.',
      });
    } catch (erreur: unknown) {
      const message =
        erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
      setEtatRattachement({ statut: 'erreur', message });
    }
  }

  const recettesActives =
    etatRecettes.statut === 'pret'
      ? etatRecettes.recettes.filter((r) => r.statut === 'active')
      : [];
  const recetteSelectionnee = recettesActives.find((r) => r.id === recetteId) ?? null;

  /**
   * Sessions candidates au rattachement : `planifiee` ou `en_cours`
   * seulement. `cloturee` est refusée côté serveur (D-024, agrégats figés) ;
   * `annulee` est exclue ici par bon sens — rattacher une production à un
   * marché annulé n'a pas d'usage, même si rien ne l'interdit techniquement.
   */
  const sessionsAttachables =
    etatSessions.statut === 'pret'
      ? etatSessions.sessions.filter((s) => s.statut === 'planifiee')
      : [];

  /**
   * Prevision retenue pour LE LANCEMENT (docs/03, D-058) : la plus RECENTE
   * previsione archivee pour la session choisie ci-dessus — meme convention
   * que `impactMesureSession` (`packages/db/src/depots/previsions.ts`), « la
   * plus proche de ce qui a reellement guide la decision de production ».
   * `GET /previsions` rend deja la liste triee de la plus recente a la plus
   * ancienne (`listerPrevisions`), donc le premier element qui correspond
   * EST la plus recente : pas de second tri a refaire ici.
   *
   * Calculee cote ECRAN et jamais cote serveur : c'est ce que le porteur voit
   * s'afficher AVANT de cliquer « Lancer la production » qui fait foi, pas un
   * choix pris apres coup par le service au moment de l'ecriture — c'est
   * exactement la distinction que ce champ existe pour capturer.
   *
   * `null` des que la session n'est pas encore choisie, ou qu'aucune
   * prevision n'a ete archivee pour elle : la production se lance alors SANS
   * prevision rattachee, un cas normal (depannage, rattrapage), jamais une
   * prevision devinee.
   */
  const previsionRetenue: PrevisionArchivee | null =
    sessionIdSaisie !== '' && etatPrevisions.statut === 'pret'
      ? (etatPrevisions.previsions.find((p) => p.sessionId === sessionIdSaisie) ?? null)
      : null;

  const productionsTriees: ProductionResume[] =
    etatHistorique.statut === 'pret'
      ? [...etatHistorique.productions].sort(comparerProductions)
      : [];

  const besoinsAffiches: BesoinIngredientContrat[] =
    etatFaisabilite !== null && etatFaisabilite.statut === 'pret'
      ? trierBesoins(etatFaisabilite.resultat)
      : [];

  const peutLancer =
    recetteId !== null &&
    parserEntierPositif(valeurSaisie) !== null &&
    dateProduction !== '' &&
    etatFaisabilite !== null &&
    etatFaisabilite.statut === 'pret' &&
    etatFaisabilite.resultat.faisable &&
    etatLancement.statut !== 'en_cours';

  const detailCourant =
    etatDetail !== null && etatDetail.statut === 'pret' ? etatDetail.detail : null;

  /**
   * Prévision suivie par cette production (docs/03, D-058), narrowed en un
   * bloc unique une fois les quatre champs nullables confirmés présents —
   * jamais d'assertion non-nulle : ces champs sont indépendants au contrat
   * (`schemaProductionDetail`), rien ne garantit à `tsc` qu'ils varient
   * ensemble sans cette étape.
   */
  const previsionAffichee =
    detailCourant !== null &&
    detailCourant.previsionId !== null &&
    detailCourant.previsionDateCalcul !== null &&
    detailCourant.previsionP50Crepes !== null &&
    detailCourant.previsionCrepesRetenues !== null
      ? {
          dateCalcul: detailCourant.previsionDateCalcul,
          p50Crepes: detailCourant.previsionP50Crepes,
          crepesRetenues: detailCourant.previsionCrepesRetenues,
          ecartVsPrevisionBp: detailCourant.ecartVsPrevisionBp,
        }
      : null;

  /**
   * Ingrédients UNIQUES consommés par cette production (docs/17 fiche 9) : la
   * saisie du réel se fait PAR INGRÉDIENT, jamais par lot — c'est ce que le
   * porteur peut réellement mesurer après une fournée (peser ce qu'il reste de
   * farine), pas « combien pris dans le lot A contre le lot B ». Reconstruit à
   * chaque rendu, comme les colonnes de `SaisieReception.tsx` : la liste tient
   * sur quelques lignes, une mémoisation coûterait plus qu'elle ne fait gagner.
   */
  const ingredientsConsommesUniques: {
    ingredientId: string;
    nomIngredient: string;
    unite: ConsommationProduction['unite'];
  }[] =
    detailCourant === null
      ? []
      : detailCourant.consommations.reduce<
          { ingredientId: string; nomIngredient: string; unite: ConsommationProduction['unite'] }[]
        >((uniques, c) => {
          if (uniques.some((u) => u.ingredientId === c.ingredientId)) return uniques;
          uniques.push({
            ingredientId: c.ingredientId,
            nomIngredient: c.nomIngredient,
            unite: c.unite,
          });
          return uniques;
        }, []);

  // Une saisie non vide qui ne se lit pas comme un entier positif ou nul
  // bloque le bouton — mieux vaut refuser que deviner (même règle que le
  // volume et les crêpes juste au-dessus).
  const consommationReelleSaisieInvalide = Object.values(consommationsReellesSaisies).some(
    (saisie) => saisie.trim() !== '' && parserEntierNonNegatif(saisie) === null,
  );

  const peutEnregistrerRealise =
    detailCourant !== null &&
    detailCourant.statut === 'lancee' &&
    parserEntierNonNegatif(volumeReelSaisi) !== null &&
    parserEntierNonNegatif(crepesReellesSaisi) !== null &&
    !consommationReelleSaisieInvalide &&
    etatRealise.statut !== 'en_cours';

  /**
   * La session ACTUELLEMENT rattachée est déjà clôturée : ses agrégats sont
   * figés (D-024), `rattacherSession` refuse tout changement dans ce cas —
   * l'écran verrouille le contrôle plutôt que de laisser l'utilisateur
   * découvrir le refus après avoir rempli le formulaire.
   */
  const sessionVerrouillee = detailCourant?.sessionStatut === 'cloturee';

  /**
   * Ce qui empêche d'annuler CETTE production, dit à la place du bouton — les
   * refus d'`annulerProduction` qui sont ANNONÇABLES, plutôt que découverts
   * après le clic. Écrit une seule fois, partagé avec `DetailLot.tsx` : deux
   * implémentations feraient dire à un écran ce que l'autre contredirait.
   */
  const blocageAnnulation =
    detailCourant === null
      ? null
      : blocageAnnulationProduction({
          statut: detailCourant.statut,
          sessionStatut: detailCourant.sessionStatut ?? null,
          sessionNumero: detailCourant.sessionNumero ?? null,
        });

  function ouvrirAnnulationProduction(): void {
    setErreursAnnulation(AUCUNE_ERREUR);
    setMotifAnnulation('');
    setAnnulationOuverte(true);
  }

  function fermerAnnulationProduction(): void {
    setAnnulationOuverte(false);
    // Le bouton « Annuler la production… » n'existe qu'au prochain rendu :
    // même patron que `boutonSortir` dans `Stock.tsx`.
    requestAnimationFrame(() => boutonOuvrirAnnulationRef.current?.focus());
  }

  /**
   * ANNULE la production ouverte (D-087) : le service contrepasse TOUS ses
   * mouvements de stock non déjà annulés — la consommation d'origine et tout
   * écart de réalisé — puis marque la production `annulee`. La matière revient
   * dans ses lots d'origine, en écritures inverses ; rien n'est effacé.
   *
   * Aucun refus n'est reconstruit ici : `blocageAnnulationProduction` annonce
   * d'avance les deux que le service oppose ET qui sont observables depuis cet
   * écran (déjà annulée, session clôturée). Tout autre refus — période
   * verrouillée comprise — arrive par le chemin d'erreur, avec le message
   * français du serveur affiché tel quel.
   */
  async function annulerLaProduction(): Promise<void> {
    if (annulationEnCours || detailCourant === null) return;
    const cible = detailCourant;

    if (motifAnnulation === '') {
      setErreursAnnulation({
        champs: { motifCode: 'Choisissez un motif dans la liste.' },
        general: null,
      });
      return;
    }

    setErreursAnnulation(AUCUNE_ERREUR);
    setAnnulationEnCours(true);

    try {
      const reponse = await requeteApi<unknown>(`/productions/${cible.id}/annuler`, {
        method: 'POST',
        body: JSON.stringify({ motifCode: motifAnnulation }),
      });
      const resultat = schemaAnnulationProductionCreee.parse(reponse);

      // Relecture du détail : le statut vient de passer à `annulee`. On le
      // RELIT plutôt que de recopier la valeur à la main — l'écran ne doit
      // jamais affirmer un état qu'il n'a pas relu.
      const detailRelu = schemaProductionDetail.parse(
        await requeteApi<unknown>(`/productions/${cible.id}`),
      );
      setAnnulationEnCours(false);
      setAnnulationOuverte(false);
      setEtatDetail({ statut: 'pret', detail: detailRelu });
      setEtatHistorique((precedent) =>
        precedent.statut === 'pret'
          ? {
              statut: 'pret',
              // La ligne RESTE dans l'historique, marquée « Annulée » : rien
              // ne s'efface (CLAUDE.md §3 règle 7, D-083).
              productions: precedent.productions.map((p) => (p.id === cible.id ? detailRelu : p)),
              total: precedent.total,
            }
          : precedent,
      );
      setMessageAnnulation(phraseApresAnnulationProduction(resultat));
      /**
       * LE FOCUS VA SUR « Fermer » DU PANNEAU DE DÉTAIL (D-079). Le bouton qui
       * vient d'agir disparaît — le bloc n'affiche plus qu'une raison — et le
       * panneau ne propose plus rien d'autre : la saisie du réalisé disparaît
       * elle aussi avec le statut `lancee`. La continuation naturelle du geste
       * est donc de quitter ce panneau, pas d'y chercher une action qui
       * n'existe plus. Ce n'est pas une cible inventée : c'est le seul
       * contrôle encore actionnable du panneau.
       */
      requestAnimationFrame(() => boutonFermerDetailRef.current?.focus());
    } catch (erreur: unknown) {
      setAnnulationEnCours(false);
      setErreursAnnulation(repartirErreurApi(erreur));
      // Le refus laisse le bloc ouvert : on rend le focus au bouton qui l'a
      // perdu en devenant `disabled` le temps de l'appel.
      requestAnimationFrame(() => boutonConfirmerAnnulationRef.current?.focus());
    }
  }

  return (
    <div className="flex flex-col gap-bloc">
      <h1 className="flex h-rangee items-center text-lg text-ink">Production</h1>

      <Panneau titre="Nouvel ordre de production">
        {etatRecettes.statut === 'chargement' && (
          <p className="text-sm text-ink-3">Chargement des recettes…</p>
        )}

        {etatRecettes.statut === 'erreur' && <MessageErreur message={etatRecettes.message} />}

        {etatRecettes.statut === 'pret' && recettesActives.length === 0 && (
          <EtatVide
            variante="premier-lancement"
            titre="Aucune recette active"
            explication="Activez au moins une recette dans l'écran Recettes pour pouvoir lancer une production."
            action={{ libelle: 'Aller aux recettes', onClick: () => navigate('/recettes') }}
          />
        )}

        {etatRecettes.statut === 'pret' && recettesActives.length > 0 && (
          <div className="flex flex-col gap-bloc">
            <div className="flex flex-wrap items-end gap-bloc">
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="production-recette"
              >
                Recette
                <select
                  id="production-recette"
                  className="h-controle w-56 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                  value={recetteId ?? ''}
                  onChange={(evenement) => setRecetteId(evenement.target.value)}
                >
                  {recettesActives.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} — {r.nom}
                    </option>
                  ))}
                </select>
              </label>

              {recetteSelectionnee !== null && (
                <fieldset className="flex flex-col gap-groupe">
                  <legend className="text-2xs uppercase text-ink-3">Cible de production</legend>
                  <label className="flex items-center gap-groupe text-sm text-ink-2">
                    <input
                      type="radio"
                      name="cible-production"
                      checked={cibleType === 'crepes'}
                      onChange={() => choisirCibleType(recetteSelectionnee, 'crepes')}
                    />
                    Un nombre de crêpes
                  </label>
                  <label className="flex items-center gap-groupe text-sm text-ink-2">
                    <input
                      type="radio"
                      name="cible-production"
                      checked={cibleType === 'volume'}
                      onChange={() => choisirCibleType(recetteSelectionnee, 'volume')}
                    />
                    Un volume de pâte
                  </label>
                </fieldset>
              )}

              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="production-valeur"
              >
                {libelleChampValeur(cibleType)}
                <input
                  id="production-valeur"
                  type="text"
                  inputMode="numeric"
                  className="num h-controle w-40 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={valeurSaisie}
                  onChange={(evenement) => setValeurSaisie(evenement.target.value)}
                  aria-invalid={erreurValeur !== null}
                  aria-describedby={erreurValeur !== null ? 'production-valeur-erreur' : undefined}
                />
              </label>

              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="production-date"
              >
                Date de production
                <input
                  id="production-date"
                  type="date"
                  className="h-controle w-40 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={dateProduction}
                  onChange={(evenement) => setDateProduction(evenement.target.value)}
                  aria-invalid={erreurDate !== null}
                  aria-describedby={erreurDate !== null ? 'production-date-erreur' : undefined}
                />
              </label>
            </div>

            {erreurValeur !== null && (
              <p id="production-valeur-erreur" className="text-sm text-depassement">
                {erreurValeur}
              </p>
            )}
            {erreurDate !== null && (
              <p id="production-date-erreur" className="text-sm text-depassement">
                {erreurDate}
              </p>
            )}

            {/* Controle de faisabilite — separe par un filet, jamais un
                second panneau (docs/07 §4.8, profondeur maximale 1). */}
            <div className="flex flex-col gap-groupe border-t border-line pt-3">
              <h3 className="text-2xs uppercase text-ink-3">Faisabilité</h3>

              {etatFaisabilite === null && (
                <EtatVide
                  variante="normal"
                  texte="Renseignez une recette et une quantité valides pour lancer le contrôle de faisabilité."
                />
              )}

              {etatFaisabilite !== null && etatFaisabilite.statut === 'erreur' && (
                <MessageErreur message={etatFaisabilite.message} />
              )}

              {etatFaisabilite !== null && etatFaisabilite.statut === 'pret' && (
                <>
                  <p className="text-sm text-ink-2">
                    Cible :{' '}
                    <span className="num text-ink">
                      {formaterQuantite(etatFaisabilite.resultat.volumeMl, 'ml')}
                    </span>
                    {' · '}
                    <span className="num text-ink">
                      {formaterCrepes(etatFaisabilite.resultat.crepes)}
                    </span>
                  </p>

                  {etatFaisabilite.resultat.faisable ? (
                    <PastilleStatut statut="conforme" libelle="Réalisable avec le stock actuel" />
                  ) : (
                    <div
                      role="alert"
                      className="border-l-2 border-depassement bg-depassement-bg px-3 py-2 text-sm text-depassement"
                    >
                      <p>{messageFaisabilite(etatFaisabilite.resultat)}</p>
                      {etatFaisabilite.resultat.volumeMaximalMl > 0 ? (
                        <>
                          <p className="mt-1">
                            Volume maximal réalisable avec le stock actuel :{' '}
                            <span className="num">
                              {formaterQuantite(etatFaisabilite.resultat.volumeMaximalMl, 'ml')}
                            </span>
                            .
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              etatFaisabilite.statut === 'pret' &&
                              basculerSurVolumeMaximal(etatFaisabilite.resultat.volumeMaximalMl)
                            }
                            className="mt-2 text-sm font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                          >
                            Utiliser ce volume comme cible
                          </button>
                        </>
                      ) : (
                        <p className="mt-1">
                          Aucune production n'est réalisable avec le stock actuel.
                        </p>
                      )}
                    </div>
                  )}

                  <Tableau
                    colonnes={COLONNES_BESOINS}
                    lignes={besoinsAffiches}
                    cleLigne={(b) => b.ingredientId}
                    etatVide={<EtatVide variante="normal" texte="Aucun ingrédient à contrôler." />}
                  />
                </>
              )}
            </div>

            {/* Finalisation de l'ordre. */}
            <div className="flex flex-wrap items-end gap-bloc border-t border-line pt-3">
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="production-session"
              >
                Session de destination (optionnel)
                <select
                  id="production-session"
                  className="h-controle w-64 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                  value={sessionIdSaisie}
                  onChange={(evenement) => setSessionIdSaisie(evenement.target.value)}
                >
                  <option value="">— Pâte en attente, pas encore de session —</option>
                  {sessionsAttachables.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.numero} — {formaterDate(s.dateSession)} — {s.lieuNom}
                    </option>
                  ))}
                </select>
                {/* Prévision retenue (docs/03, D-058) : affichée AVANT le
                    lancement, c'est elle — et seulement elle — qui est
                    rattachée au clic sur « Lancer la production ». Un simple
                    texte, pas une alerte : l'absence de prévision est un cas
                    normal, pas une erreur de saisie. */}
                {sessionIdSaisie !== '' && previsionRetenue !== null && (
                  <p className="max-w-[16rem] text-xs text-ink-3">
                    Prévision retenue : calculée le {formaterDateHeure(previsionRetenue.dateCalcul)}
                    {' — '}
                    {formaterCrepes(previsionRetenue.crepesRetenues)} retenues.
                  </p>
                )}
                {sessionIdSaisie !== '' && previsionRetenue === null && (
                  <p className="max-w-[16rem] text-xs text-ink-3">
                    Aucune prévision archivée pour cette session : lancée sans référence.
                  </p>
                )}
              </label>

              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="production-notes"
              >
                Notes (optionnel)
                <input
                  id="production-notes"
                  type="text"
                  className="h-controle w-64 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                  value={notesSaisie}
                  onChange={(evenement) => setNotesSaisie(evenement.target.value)}
                />
              </label>
            </div>
            {/*
              Pas de « motif d'écart » au lancement : docs/01 module 3 demande de
              motiver un écart par rapport à l'ordre SUGGÉRÉ, or cet ordre vient
              du moteur de prévision (Lot 5). Sans référence à laquelle se
              comparer, le champ n'aurait aucun sens — et il partagerait la même
              colonne que le motif d'écart du réalisé, qui l'écraserait.
            */}

            <div className="flex items-center gap-groupe">
              <button
                type="button"
                onClick={() => void lancerProduction()}
                disabled={!peutLancer}
                className="flex h-controle w-56 items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {etatLancement.statut === 'en_cours' ? 'Lancement…' : 'Lancer la production'}
              </button>
              {etatLancement.statut === 'succes' && (
                <p role="status" className="text-sm text-conforme">
                  {etatLancement.message}
                </p>
              )}
            </div>
            {etatLancement.statut === 'erreur' && <MessageErreur message={etatLancement.message} />}
          </div>
        )}
      </Panneau>

      {etatHistorique.statut === 'chargement' && (
        <p className="text-sm text-ink-3">Chargement de l'historique…</p>
      )}

      {etatHistorique.statut === 'erreur' && <MessageErreur message={etatHistorique.message} />}

      {etatHistorique.statut === 'pret' && (
        <div className="flex flex-col items-start gap-bloc lg:flex-row">
          {/* `ref` + `tabIndex={-1}` : repli de focus de `fermerDetailProduction`
              quand la rangée précédemment sélectionnée n'est, pour une raison
              quelconque, pas retrouvée — programmatique uniquement, jamais dans
              l'ordre de tabulation normal. */}
          <div ref={panneauHistoriqueRef} tabIndex={-1} className="min-w-0 flex-1 self-stretch">
            <Panneau
              titre={compteAccorde(etatHistorique.total, 'production', 'productions')}
              sansRembourrage
            >
              <Tableau
                colonnes={colonnesHistorique(horizonDlcJours)}
                lignes={productionsTriees}
                cleLigne={(p) => p.id}
                {...(productionSelectionneeId !== null
                  ? { ligneSelectionneeCle: productionSelectionneeId }
                  : {})}
                onSelectionnerLigne={selectionnerProduction}
                etatVide={
                  <EtatVide
                    variante="premier-lancement"
                    titre="Aucune production enregistrée"
                    explication="Lancez votre première production avec le formulaire ci-dessus."
                  />
                }
              />
              {horizonDlcJours !== null && productionsTriees.length > 0 && (
                // Meme fenetre, meme phrase que Stock.tsx et que le brief
                // avant-marche : un chiffre sans sa fenetre est incomparable.
                <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
                  Le compteur sous « DLC pâte » s'affiche à moins de {horizonDlcJours} jour
                  {horizonDlcJours > 1 ? 's' : ''} de l'échéance — même fenêtre que le brief
                  avant-marché.
                </p>
              )}
            </Panneau>
          </div>

          {detailCourant !== null && (
            <div className="w-full lg:w-[26.25rem] lg:shrink-0">
              <Panneau titre={detailCourant.numero} sansRembourrage>
                <div className="flex items-center justify-between border-b border-line px-4 py-2">
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {detailCourant.recetteCode} — {detailCourant.recetteNom}
                    </p>
                    <p className="text-xs text-ink-3">
                      Produit le {formaterDate(detailCourant.dateProduction)}
                      {' · '}
                      {detailCourant.volumeReelMl !== null
                        ? formaterQuantite(detailCourant.volumeReelMl, 'ml')
                        : `${formaterQuantite(detailCourant.volumeTheoriqueMl, 'ml')} (théorique)`}
                      {' · '}
                      {detailCourant.crepesReelles !== null
                        ? formaterCrepes(detailCourant.crepesReelles)
                        : `${formaterCrepes(detailCourant.crepesTheoriques)} (théorique)`}
                      {' · '}
                      {
                        /* `coutMatiereTheoriqueCents` (`schemaProductionResume`,
                           docs/21-CHAMPS-NON-LUS.md §1.1 voisin) : calculé, testé,
                           servi par `GET /productions`, jamais affiché avant ce
                           correctif — le coût matière réel d'une fournée n'était
                           visible NULLE PART dans cet écran. */
                        formaterMontant(detailCourant.coutMatiereTheoriqueCents)
                      }{' '}
                      de matière (théorique)
                    </p>
                  </div>
                  <button
                    type="button"
                    // Cible de focus après une annulation réussie : c'est le
                    // seul contrôle encore actionnable du panneau à cet
                    // instant (voir `annulerLaProduction`).
                    ref={boutonFermerDetailRef}
                    onClick={fermerDetailProduction}
                    className="text-xs font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Fermer
                  </button>
                </div>

                {/* L'étiquette s'imprime ICI, sur la ligne qui porte le numéro
                    de lot et la DLC : c'est exactement ce que l'étiquette
                    contient, et le geste qui suit est de la coller sur le bac.
                    Un menu « Exports » séparé forcerait à retrouver la
                    production dont on vient de lire le numéro. */}
                <div className="flex flex-wrap items-center justify-between gap-groupe border-b border-line px-4 py-2">
                  <p className="text-sm text-ink-2">
                    Lot de pâte{' '}
                    <span className="font-mono text-xs text-ink">
                      {detailCourant.numeroLotPate}
                    </span>
                    {' — DLC '}
                    {rendreDlcPate(detailCourant.dateDlcPate, horizonDlcJours)}
                  </p>
                  <BoutonDocument
                    chemin={`/documents/etiquette-bac/${detailCourant.id}`}
                    libelle="Étiquette du bac (PDF)"
                    libelleAttente="Édition de l’étiquette…"
                  />
                </div>

                {/* Rattachement à une session, APRÈS le lancement (docs/14
                    G1/G4, second geste demandé — celui qui compte autant que
                    le premier) : on lance souvent la pâte avant que la
                    session du marché n'existe encore. */}
                <div className="border-b border-line px-4 py-2">
                  <h3 className="text-2xs uppercase text-ink-3">Session de vente</h3>
                  <div className="mt-1 flex flex-wrap items-end justify-between gap-groupe">
                    <div>
                      {detailCourant.sessionNumero !== null &&
                      detailCourant.sessionNumero !== undefined ? (
                        <p className="text-sm text-ink">
                          Rattachée à{' '}
                          <span className="font-mono text-xs">{detailCourant.sessionNumero}</span>
                        </p>
                      ) : (
                        <PastilleStatut
                          statut="alerte"
                          libelle="Aucune session rattachée : son coût matière n'entre dans aucune marge."
                        />
                      )}
                    </div>

                    {sessionVerrouillee ? (
                      <p className="max-w-[13.75rem] text-xs text-ink-3">
                        Session déjà clôturée : ses agrégats sont figés (D-024), le rattachement ne
                        peut plus changer.
                      </p>
                    ) : (
                      <div className="flex items-end gap-groupe">
                        <label
                          className="flex flex-col gap-groupe text-sm text-ink-2"
                          htmlFor="production-rattachement"
                        >
                          Rattacher à
                          <select
                            id="production-rattachement"
                            className="h-controle w-48 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                            value={sessionIdRattachement}
                            onChange={(evenement) =>
                              setSessionIdRattachement(evenement.target.value)
                            }
                          >
                            <option value="">— Aucune (détacher) —</option>
                            {sessionsAttachables.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.numero} — {formaterDate(s.dateSession)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={() => void rattacherSessionProduction()}
                          disabled={etatRattachement.statut === 'en_cours'}
                          className="flex h-controle items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {etatRattachement.statut === 'en_cours'
                            ? 'Enregistrement…'
                            : 'Enregistrer'}
                        </button>
                      </div>
                    )}
                  </div>

                  {etatRattachement.statut === 'erreur' && (
                    <div className="mt-2">
                      <MessageErreur message={etatRattachement.message} />
                    </div>
                  )}
                  {etatRattachement.statut === 'succes' && (
                    <p role="status" className="mt-2 text-sm text-conforme">
                      {etatRattachement.message}
                    </p>
                  )}
                </div>

                {/* Prévision suivie (docs/03, D-058) : uniquement relue ici —
                    aucun calcul de prévision (CLAUDE.md §3 règle 2). N'est
                    affichée que si une prévision a été rattachée au
                    lancement : `null` est un cas normal (décidée sans
                    prévision), pas une anomalie à signaler. */}
                {previsionAffichee !== null && (
                  <div className="border-b border-line px-4 py-2 text-sm text-ink-2">
                    <h3 className="text-2xs uppercase text-ink-3">Prévision suivie</h3>
                    <p className="mt-1">
                      Calculée le {formaterDateHeure(previsionAffichee.dateCalcul)}
                      {' — '}
                      P50 {formaterCrepes(previsionAffichee.p50Crepes)}
                      {', '}
                      {formaterCrepes(previsionAffichee.crepesRetenues)} retenues.
                    </p>
                    {previsionAffichee.ecartVsPrevisionBp !== null && (
                      <p className="mt-1">
                        Écart vs prévision :{' '}
                        <span className="num text-ink">
                          {formaterEcartPourcent(previsionAffichee.ecartVsPrevisionBp)}
                        </span>
                      </p>
                    )}
                  </div>
                )}

                <div className="border-b border-line px-4 pt-3 pb-1">
                  <h3 className="text-2xs uppercase text-ink-3">
                    Consommations (traçabilité des lots)
                  </h3>
                </div>
                <Tableau
                  colonnes={COLONNES_CONSOMMATIONS}
                  lignes={detailCourant.consommations}
                  cleLigne={(c) => c.lotId}
                  etatVide={<EtatVide variante="normal" texte="Aucune consommation enregistrée." />}
                />

                {/* LE TOTAL, posé directement sous la colonne qui doit s'y
                    additionner. Il est SERVI par la route, jamais recalculé
                    ici (CLAUDE.md §3 règle 1) — et c'est ce total-là que la
                    clôture de session facture à la marge du marché, pendant
                    que l'écran n'affichait jusqu'ici que le théorique.
                    L'invariant est vérifiable à l'œil sur cet écran :
                    somme(« Coût réel ») + sur-consommation hors fournée
                    ci-dessous = ce total. */}
                <div className="border-b border-line px-4 py-2 text-sm text-ink-2">
                  <p>
                    Coût matière réel de la fournée :{' '}
                    <span className="num text-ink">
                      {ouTiret(detailCourant.coutMatiereReelCents, formaterEuros)}
                    </span>
                  </p>
                  {/* RIEN quand il vaut 0 : c'est le cas normal (tout est
                      rattaché à un lot de la fournée), et un bandeau affiché à
                      chaque production cesserait d'être lu le jour où il
                      compterait. Rien non plus quand il est `null` — le réalisé
                      n'est simplement pas encore saisi. */}
                  {detailCourant.coutMatiereReelNonAffecteCents !== null &&
                    detailCourant.coutMatiereReelNonAffecteCents !== undefined &&
                    detailCourant.coutMatiereReelNonAffecteCents !== 0 && (
                      <p className="mt-groupe text-alerte">
                        <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span> Sur-consommation
                        servie par un lot hors fournée :{' '}
                        {formaterEuros(detailCourant.coutMatiereReelNonAffecteCents)}. Ce lot
                        n’apparaît pas dans la traçabilité ci-dessus : un rappel de marchandise
                        partant de ce lot ne remonterait pas jusqu’à cette production.
                      </p>
                    )}
                </div>

                {detailCourant.ecartRendementBp !== null && (
                  <p className="border-b border-line px-4 py-2 text-sm text-ink-2">
                    Écart de rendement :{' '}
                    <span className="num text-ink">
                      {formaterEcartPourcent(detailCourant.ecartRendementBp)}
                    </span>
                  </p>
                )}

                {(detailCourant.ecartMotif !== null || detailCourant.notes !== null) && (
                  <div className="border-b border-line px-4 py-2 text-sm text-ink-2">
                    {detailCourant.ecartMotif !== null && (
                      <p>Motif d'écart : {detailCourant.ecartMotif}</p>
                    )}
                    {detailCourant.notes !== null && <p>Notes : {detailCourant.notes}</p>}
                  </div>
                )}

                {detailCourant.statut === 'lancee' && (
                  // Vrai `<form>` : la saisie du réalisé se fait après coup, au
                  // clavier, production par production. `Entrée` y valide.
                  // À NE PAS étendre au bloc « Lancer la production » plus haut :
                  // celui-là consomme le stock en FEFO de façon irréversible, et
                  // le rendre déclenchable par `Entrée` créerait exactement le
                  // geste destructif par mégarde qu'on cherche à éviter.
                  <form
                    onSubmit={(evenement) => {
                      evenement.preventDefault();
                      void enregistrerRealise();
                    }}
                    className="px-4 py-3"
                  >
                    <h3 className="text-2xs uppercase text-ink-3">Saisie du réalisé</h3>
                    <div className="mt-2 flex flex-wrap items-end gap-bloc">
                      <label
                        className="flex flex-col gap-groupe text-sm text-ink-2"
                        htmlFor="realise-volume"
                      >
                        Volume réel (ml)
                        <input
                          id="realise-volume"
                          type="text"
                          inputMode="numeric"
                          className="num h-controle w-32 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                          value={volumeReelSaisi}
                          onChange={(evenement) => setVolumeReelSaisi(evenement.target.value)}
                        />
                      </label>
                      <label
                        className="flex flex-col gap-groupe text-sm text-ink-2"
                        htmlFor="realise-crepes"
                      >
                        Crêpes réelles
                        <input
                          id="realise-crepes"
                          type="text"
                          inputMode="numeric"
                          className="num h-controle w-32 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                          value={crepesReellesSaisi}
                          onChange={(evenement) => setCrepesReellesSaisi(evenement.target.value)}
                        />
                      </label>
                      <label
                        className="flex flex-col gap-groupe text-sm text-ink-2"
                        htmlFor="realise-motif"
                      >
                        Motif d'écart (optionnel)
                        <input
                          id="realise-motif"
                          type="text"
                          className="h-controle w-64 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                          value={motifRealiseSaisi}
                          onChange={(evenement) => setMotifRealiseSaisi(evenement.target.value)}
                        />
                      </label>
                    </div>

                    {ingredientsConsommesUniques.length > 0 && (
                      // Consommation RÉELLE par ingrédient (docs/17 fiche 9) :
                      // optionnelle, une saisie vide n'est pas déclarée. Chaque
                      // écart déclaré ici devient un vrai mouvement de stock
                      // rattaché à cette production (règle n°5), jamais une
                      // valeur dérivée par ratio du volume global.
                      <div className="mt-3 flex flex-col gap-groupe border-t border-line pt-3">
                        <h4 className="text-2xs uppercase text-ink-3">
                          Consommation réelle par ingrédient (optionnel)
                        </h4>
                        <div className="flex flex-wrap items-end gap-bloc">
                          {ingredientsConsommesUniques.map((ing) => (
                            <label
                              key={ing.ingredientId}
                              className="flex flex-col gap-groupe text-sm text-ink-2"
                              htmlFor={`realise-conso-${ing.ingredientId}`}
                            >
                              {ing.nomIngredient} ({libelleUnite(ing.unite)})
                              <input
                                id={`realise-conso-${ing.ingredientId}`}
                                type="text"
                                inputMode="numeric"
                                placeholder={TIRET_ABSENT}
                                className="num h-controle w-28 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                                value={consommationsReellesSaisies[ing.ingredientId] ?? ''}
                                onChange={(evenement) =>
                                  setConsommationsReellesSaisies((precedent) => ({
                                    ...precedent,
                                    [ing.ingredientId]: evenement.target.value,
                                  }))
                                }
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {etatRealise.statut === 'erreur' && (
                      <div className="mt-2">
                        <MessageErreur message={etatRealise.message} />
                      </div>
                    )}

                    <div className="mt-3 flex items-center gap-groupe">
                      <button
                        type="submit"
                        disabled={!peutEnregistrerRealise}
                        className="flex h-controle w-64 items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {etatRealise.statut === 'en_cours'
                          ? 'Enregistrement…'
                          : 'Enregistrer le réalisé'}
                      </button>
                    </div>
                  </form>
                )}

                {/*
                  Confirmation du réalisé (défaut réel corrigé le 01/08/2026,
                  `Production.montage.test.tsx`) : `PATCH /realise` FORCE
                  `statut: 'terminee'` (`packages/db/src/services/production.ts`),
                  donc le `<form>` ci-dessus — et le `<p role="status">` qui y
                  vivait — se démontait AU MÊME rendu que la réponse de succès,
                  avant d'avoir jamais été peint. Sortie du bloc conditionnel
                  `statut === 'lancee'` : ce paragraphe ne dépend plus que de
                  `etatRealise`, jamais du statut de la production, donc il
                  survit à la transition `lancee` → `terminee` qui l'effaçait.
                  Même patron que `messageAnnulation` juste plus bas, déjà
                  correct pour l'annulation. */}
                {etatRealise.statut === 'succes' && (
                  <p role="status" className="border-b border-line px-4 py-2 text-sm text-conforme">
                    {etatRealise.message}
                  </p>
                )}

                {/* ═══ Annuler la production (D-087) ═════════════════════
                    EN DERNIER dans le panneau, après la saisie du réalisé :
                    le geste courant est de saisir ce qui a été produit,
                    l'annulation est l'exception. Placé ici, il ne s'interpose
                    jamais dans l'ordre de tabulation du geste fréquent. */}
                <BlocAnnulation
                  titre="Annulation"
                  identite={
                    <>
                      {'Lancée le '}
                      {formaterDate(detailCourant.dateProduction)}
                      {' — statut '}
                      <span className="font-medium text-ink">
                        {LIBELLE_STATUT_PRODUCTION[detailCourant.statut]}
                      </span>
                      {'.'}
                    </>
                  }
                  blocage={blocageAnnulation}
                  ouvert={annulationOuverte}
                  onOuvrir={ouvrirAnnulationProduction}
                  onFermer={fermerAnnulationProduction}
                  libelleOuverture="Annuler la production…"
                  phraseAvant={phraseAvantAnnulationProduction({
                    numero: detailCourant.numero,
                  })}
                  libelleConfirmation="Annuler la production"
                  nomChampMotif="motifAnnulationProduction"
                  motif={motifAnnulation}
                  onMotifChange={setMotifAnnulation}
                  erreurs={erreursAnnulation}
                  enCours={annulationEnCours}
                  onConfirmer={() => void annulerLaProduction()}
                  refOuvrir={boutonOuvrirAnnulationRef}
                  refConfirmer={boutonConfirmerAnnulationRef}
                />

                {messageAnnulation !== null && (
                  <p role="status" className="px-4 py-2 text-sm text-conforme">
                    {messageAnnulation}
                  </p>
                )}
              </Panneau>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
