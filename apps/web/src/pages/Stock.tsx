import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GLYPHE_STATUT,
  TIRET_ABSENT,
  avertissementsReceptionAAfficher,
  estPerime,
  formaterDate,
  formaterDateTableau,
  formaterEuros,
  formaterJoursRestants,
  formaterMontant,
  formaterQuantite,
  mentionCommandeSoldee,
  ouTiret,
  schemaDiagnosticIntegriteStock,
  schemaEtatStock,
  schemaListeLots,
  schemaListeParametres,
  statutStock,
  valoriserStock,
  valoriserStockPerime,
  type DiagnosticIntegriteStockContrat,
  type LigneStockContrat,
  type LotDetail,
  type Parametre,
  type Statut,
  type StatutLot,
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
  BandeauAlerte,
  BandeauErreur,
  BandeauSucces,
  CLASSE_BOUTON_LIEN,
  CLASSE_BOUTON_PRIMAIRE,
  CLASSE_BOUTON_SECONDAIRE,
} from '../saisie-stock/champs';
import { SaisieReception, type ReceptionEnregistree } from '../saisie-stock/SaisieReception';
import { SaisieSortie, type SortieEnregistree } from '../saisie-stock/SaisieSortie';
import { DetailLot } from '../saisie-stock/DetailLot';

/**
 * Ecran Stock (docs/06 §4 : « un seul tableau dense, trié par urgence »).
 *
 * L'ecran fait UNE chose : montrer l'etat du stock et ce qui le fait bouger.
 * Il a trois modes exclusifs, jamais deux a l'ecran en meme temps :
 *
 *  - `consultation` : le tableau, plus le detail par lot de l'ingredient choisi ;
 *  - `reception`    : la saisie d'une reception, en pleine largeur — c'est une
 *    PIECE qu'on recopie depuis un bon de livraison papier, elle merite la
 *    largeur et n'a pas besoin du tableau derriere elle ;
 *  - la sortie de correction, qui s'ouvre DANS le panneau de l'ingredient
 *    concerne : on voit les lots que la FEFO va servir pendant qu'on saisit.
 *
 * Regle d'architecture n°1 (CLAUDE.md §3) : ce composant n'effectue AUCUN
 * calcul metier. Chaque quantite, chaque valeur affichee vient telle quelle
 * de l'API (`LigneStockContrat`, `LotDetail`). Le tri et le choix d'un
 * formateur sont de la presentation — docs/07 §4.5 le permet explicitement
 * (« le tri ... est permis ») — mais aucune arithmetique metier n'est
 * introduite ici : voir le commentaire de `statutLigne` pour le premier point
 * ou ce principe demandait un examen attentif, et celui de `valorisationLots`
 * (mission « un lot perime ne pese plus dans la valeur du stock », 01/08/2026)
 * pour le second — les DEUX delegent le calcul a `packages/core`, jamais a
 * une formule ecrite ici.
 *
 * Detail de l'ingredient (docs/07 : « pas une modale, pas une page ») : ni
 * modale (aucun fond assombri, le tableau reste utilisable), ni page (aucun
 * changement de route) — un panneau contextuel qui s'ouvre SOUS le tableau, en
 * pleine largeur.
 *
 * CE PANNEAU ETAIT UNE SECONDE COLONNE DE 360 px, ET IL A CHANGE DE PLACE.
 * Mesure au navigateur, viewport 1280x720 : a 360 px, puis a 440 px, les six
 * colonnes du detail ne tenaient pas. « Disponible » se cassait en trois
 * morceaux (« Disp / oni / ble »), la date de reception tombait a « 27/… », et
 * le montant paye — la valeur qu'on rapproche de la facture — n'avait pas la
 * place d'exister. Une colonne docked etait le bon choix tant que le detail se
 * contentait de cinq colonnes en lecture ; il porte desormais le prix paye ET
 * un formulaire de sortie, et la LARGEUR est devenue la contrainte. En pleine
 * largeur, plus rien ne se casse, et le formulaire de sortie tient sur une
 * rangee au lieu d'une colonne de six champs empiles.
 *
 * Contrepartie assumee : le detail peut naitre sous la ligne de flottaison. La
 * selection le fait donc defiler a l'ecran, sinon un clic n'aurait aucun effet
 * visible — le pire retour possible.
 */

/* Date du jour lue à chaque appel, jamais figée à l'import : voir `aujourdHui`
   dans `lib/dates.ts`. */

const RANG_STATUT: Readonly<Record<Statut, number>> = {
  depassement: 0,
  alerte: 1,
  conforme: 2,
};

const CLASSE_TEXTE_STATUT: Readonly<Record<Statut, string>> = {
  depassement: 'text-depassement',
  alerte: 'text-alerte',
  conforme: 'text-conforme',
};

const LIBELLE_STATUT_INGREDIENT: Readonly<Record<Statut, string>> = {
  depassement: 'Commander',
  alerte: 'À surveiller',
  conforme: 'OK',
};

const LIBELLE_STATUT_LOT: Readonly<Record<StatutLot, string>> = {
  disponible: 'Disponible',
  quarantaine: 'Quarantaine',
  bloque: 'Bloqué',
  detruit: 'Détruit',
};

type Mode = 'consultation' | 'reception';

type LigneAvecStatut = LigneStockContrat & { readonly statut: Statut };

/**
 * Un lot, augmente de ce que la cellule doit AFFICHER. Les chaines sont
 * construites dans le composant et non dans la colonne parce qu'elles ont
 * besoin de l'unite, qui vit sur l'ingredient et non sur le lot.
 */
type LotAffiche = LotDetail & {
  readonly restantFormatte: string;
  readonly payeFormatte: string;
  readonly titrePaye: string;
};

type EtatStockEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | {
      statut: 'pret';
      lignes: LigneStockContrat[];
      total: number;
      valeurTotaleCents: number;
      nbAReapprovisionner: number;
    };

type EtatLots =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; lots: LotDetail[] };

/**
 * Etat du diagnostic d'integrite du stock (`GET /api/stock/integrite`).
 *
 * Le controle rend TOUJOURS un verdict explicite : `fait` couvre aussi bien
 * le cas coherent que le cas fautif — jamais seulement l'un des deux
 * (CLAUDE.md §4, un silence rassurant est un echec silencieux).
 */
type EtatIntegrite =
  | { statut: 'inactif' }
  | { statut: 'en_cours' }
  | { statut: 'fait'; resultat: DiagnosticIntegriteStockContrat }
  | { statut: 'erreur'; message: string };

/**
 * Statut d'un INGREDIENT, agrege sur tous ses lots.
 *
 * Deux informations INDEPENDANTES, combinees ICI comme `statutAfficheLot`
 * (plus bas) le fait deja pour un LOT : la quantite face au stock de securite
 * (`statutStock`, seuil-PLANCHER) et la peremption du lot le plus ancien
 * (`estPerime` sur `dlcLaPlusProche`). Avant ce correctif, seule la quantite
 * comptait : un ingredient dont le lot le plus ancien etait perime depuis 208
 * jours, mais dont la quantite totale restait au-dessus du seuil de securite,
 * s'affichait « ● OK » (G6, docs/14-TEST-PARCOURS-UTILISATEUR.md, mise a jour
 * du 30/07/2026 — « defaut adjacent » laisse ouvert par le correctif de
 * `statutAfficheLot`).
 *
 * `statutStock` (`@batte/core`) reste INCHANGEE : elle est appelee ailleurs
 * (`TableauDeBord.tsx`, `apps/api/src/routes/{stock,previsions}.ts`) sans
 * aucune notion de DLC, et n'en a pas besoin — lui faire porter la peremption
 * romprait tous ces appels pour un besoin qui n'existe qu'ICI, a l'affichage
 * d'un ingredient. La combinaison reste donc au meme endroit que pour un LOT :
 * l'ecran, jamais le calcul metier partage.
 *
 * Perime l'emporte TOUJOURS sur la quantite : de la matiere qu'on ne peut pas
 * utiliser n'est pas « disponible », meme abondante — c'est plus grave qu'un
 * simple manque, jamais moins.
 */
export function statutLigne(
  ligne: Pick<LigneStockContrat, 'dlcLaPlusProche' | 'quantiteDisponible' | 'stockSecurite'>,
  jourReference: string,
): Statut {
  if (estPerime(ligne.dlcLaPlusProche, jourReference)) return 'depassement';
  return statutStock(ligne.quantiteDisponible, ligne.stockSecurite);
}

/** Le statut d'un LOT (quatre valeurs, docs/07 §6.8 rang 10) reprend la meme
 * echelle glyphe + couleur a trois etats que le statut d'un INGREDIENT, pour
 * une lecture uniforme du tableau : quarantaine se lit comme une alerte,
 * bloque et detruit comme un depassement. Un simple mappage fixe, comme
 * `libelleStatutRecette` dans `Recettes.tsx` — aucun calcul. */
function statutAffichageLot(statut: StatutLot): Statut {
  switch (statut) {
    case 'disponible':
      return 'conforme';
    case 'quarantaine':
      return 'alerte';
    case 'bloque':
    case 'detruit':
      return 'depassement';
  }
}

/**
 * Ce que la colonne Statut du DETAIL d'un lot doit vraiment afficher.
 *
 * `statut` (table `lot`) est un etat ADMINISTRATIF : disponible, quarantaine,
 * bloque, detruit — il ne dit rien de la DLC. Avant ce correctif, l'ecran
 * affichait « Disponible » sur un lot administrativement disponible mais
 * perime depuis 208 jours (G6, docs/14-TEST-PARCOURS-UTILISATEUR.md) : le
 * moteur avait raison (FEFO et `quantiteDisponible` de `@batte/core`
 * l'excluent deja des deux), c'etait l'ETIQUETTE qui mentait.
 *
 * On ne cree AUCUN etat en base ici : `statut` reste l'unique verite
 * administrative. Seule la FORMULATION affichee change, et seulement pour le
 * cas qui pretait a confusion — un lot `disponible` mais perime se lit
 * desormais « Perime ». Quarantaine, bloque et detruit ne sont pas
 * reevalues : ces trois etats disent deja « indisponible », peu importe la
 * DLC, et les recroiser ajouterait une distinction que personne ne demande.
 *
 * `jourReference` est un PARAMETRE explicite, jamais lu via `aujourdHui()` a
 * l'interieur : c'est ce qui rend la fonction testable sans dependre de la
 * date reelle du jour (voir `Stock.test.ts`).
 */
export function statutAfficheLot(
  lot: Pick<LotDetail, 'statut' | 'dateDlc'>,
  jourReference: string,
): { statut: Statut; libelle: string } {
  if (lot.statut === 'disponible' && estPerime(lot.dateDlc, jourReference)) {
    return { statut: 'depassement', libelle: 'Périmé' };
  }
  return { statut: statutAffichageLot(lot.statut), libelle: LIBELLE_STATUT_LOT[lot.statut] };
}

/**
 * Valeur EXPLOITABLE et valeur PÉRIMÉE des lots d'un ingrédient, recalculées
 * ICI à partir du détail par lot déjà reçu (`GET /stock/:id/lots`) — jamais
 * un second appel réseau.
 *
 * DÉFAUT CORRIGÉ (mission « un lot périmé ne pèse plus dans la valeur du
 * stock », 01/08/2026, docs/27-PARCOURS-REJOUE.md §3.b) : café moulu,
 * 200 g reçus avec une DLC déjà dépassée, 0 g disponible, mais 3,00 €
 * comptés quand même dans une valeur totale de 82,12 €. La colonne
 * « Valeur (€) » du tableau ci-dessus et le bandeau « Valeur totale » restent
 * alimentés par `LigneStockContrat.valeurCents`/`meta.valeurTotaleCents`,
 * calculés par `etatDuStock` (`packages/db/src/depots/stock.ts:279`) — ce
 * fichier vit dans `packages/db/**`, hors zone d'écriture de cette mission
 * (trois autres agents y travaillent), et son appel à `valoriserStock`
 * N'A PAS ENCORE été migré pour passer `jourReference` (voir le commentaire
 * de `valoriserStock`, `packages/core/src/stock.ts`) : ces deux chiffres-là
 * restent donc, pour l'instant, ceux d'AVANT ce correctif. C'est pourquoi ce
 * panneau de détail affiche un troisième chiffre, distinct et étiqueté
 * « Valeur exploitable » : lui seul reflète déjà la correction, parce qu'il
 * délègue à la version corrigée de `valoriserStock`/`valoriserStockPerime`
 * sur les lots que ce panneau a déjà en main.
 *
 * AUCUNE arithmétique propre : cette fonction assemble deux appels à
 * `@batte/core`, exactement comme `statutLigne` ci-dessus assemble
 * `estPerime` et `statutStock` sans inventer de calcul.
 */
export function valorisationLots(
  lots: readonly LotDetail[],
  jourReference: string,
): { readonly exploitableCents: number; readonly perimeeCents: number } {
  return {
    exploitableCents: valoriserStock(lots, jourReference),
    perimeeCents: valoriserStockPerime(lots, jourReference),
  };
}

function libelleLots(nbLots: number): string {
  return `${nbLots} ${nbLots <= 1 ? 'lot' : 'lots'}`;
}

/**
 * Tri par urgence, jamais alphabetique (docs/07 §4.5) : depassement, puis
 * alerte, puis conforme ; a statut egal, la DLC la plus proche d'abord. Un
 * lot sans DLC (ingredient non perissable) part en dernier — meme logique
 * que `ordonnerFefo` dans `packages/core/src/stock.ts` : une denree non
 * perissable n'est jamais urgente.
 */
function comparerLignes(a: LigneAvecStatut, b: LigneAvecStatut): number {
  const rangA = RANG_STATUT[a.statut];
  const rangB = RANG_STATUT[b.statut];
  if (rangA !== rangB) return rangA - rangB;
  if (a.dlcLaPlusProche === null && b.dlcLaPlusProche === null) return 0;
  if (a.dlcLaPlusProche === null) return 1;
  if (b.dlcLaPlusProche === null) return -1;
  return a.dlcLaPlusProche.localeCompare(b.dlcLaPlusProche);
}

/**
 * Valeur ENTIERE en vigueur d'un parametre du catalogue, a partir d'une
 * reponse deja validee de `GET /parametres` (qui rend TOUTES les versions,
 * passees et futures, de TOUS les parametres — docs/06).
 *
 * Reproduit fidelement la resolution de `regrouperParCle` (`Parametres.tsx`) :
 * la version la plus recente dont `dateDebutValidite` est deja passee, ou a
 * defaut la plus ancienne. DUPLIQUEE plutot que partagee : aucun fichier hors
 * `apps/web/src/pages/**` n'est dans la zone d'ecriture de cette mission
 * (correctif « brief vs ecrans », 01/08/2026) — a redescendre dans
 * `apps/web/src/lib/` des que cette contrainte se leve.
 *
 * Rend `null` si la cle est absente : mieux vaut un horizon silencieusement
 * absent qu'une valeur inventee (CLAUDE.md : « valeur inconnue -> null »).
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
 * Date + compteur relatif (« 29/07  J-3 »), jamais la date seule quand
 * l'echeance est proche (docs/06 §4). `formaterJoursRestants` rend `null`
 * au-dela de son horizon : le compteur disparait alors silencieusement, la
 * date reste. Une DLC absente s'ecrit `—`, jamais une chaine vide.
 *
 * `formaterDateTableau` et non `formaterDate` : en cellule, l'annee ne
 * s'ecrit que si elle differe de l'annee courante (docs/07 §4.5). Repeter
 * « /2026 » sur quarante lignes est du bruit — et ici, c'est ce bruit qui
 * faisait deborder la colonne DLC du panneau lateral.
 *
 * DLC DEJA DEPASSEE (compteur « J+n », `estPerime` vrai) : meme glyphe et
 * meme couleur que la colonne Statut en depassement, au lieu du gris neutre
 * utilise pour une echeance encore a venir. Avant ce correctif, « J-3 »
 * (perime dans 3 jours) et « J+208 » (perime depuis 208 jours) rendaient
 * exactement le meme texte gris discret — invisible au premier coup d'oeil,
 * precisement ce que G6 (docs/14) reprochait a l'ecran.
 *
 * `jourReference` en parametre, meme raison que `statutAfficheLot` ci-dessus.
 *
 * `horizonDlcJours` VIENT DU PARAMETRE `brief_horizon_alerte_dlc_jours`
 * (correctif « brief vs ecrans », 01/08/2026, docs/29-VALEURS-EN-DUR.md §4) —
 * jamais plus d'un defaut fige a 14 dans `formaterJoursRestants` : ce
 * defaut faisait dire a cet ecran qu'un lot a 11 jours de sa DLC etait
 * proche (11 <= 14), alors que le brief avant-marche, lisant CE MEME
 * parametre (7 jours par defaut), le declarait hors fenetre (11 > 7) — deux
 * documents contradictoires sur le meme lot, a la meme seconde. `null` tant
 * que le parametre n'est pas encore charge : aucun compteur ne s'affiche
 * plutot que d'en inventer un.
 */
function rendreDlc(
  dlc: string | null,
  anneeReference: number,
  jourReference: string,
  horizonDlcJours: number | null,
) {
  if (dlc === null) return TIRET_ABSENT;
  if (horizonDlcJours === null) return formaterDateTableau(dlc, anneeReference);
  const compteur = formaterJoursRestants(dlc, jourReference, horizonDlcJours);
  if (compteur === null) return formaterDateTableau(dlc, anneeReference);
  const depassee = estPerime(dlc, jourReference);
  return (
    <span className="inline-flex items-baseline gap-groupe">
      <span>{formaterDateTableau(dlc, anneeReference)}</span>
      <span
        className={`text-xs ${depassee ? `${CLASSE_TEXTE_STATUT.depassement} font-medium` : 'text-ink-3'}`}
      >
        {depassee && <span aria-hidden="true">{GLYPHE_STATUT.depassement} </span>}
        {compteur}
      </span>
    </span>
  );
}

function colonnesStock(
  anneeReference: number,
  jourReference: string,
  horizonDlcJours: number | null,
): ReadonlyArray<ColonneTableau<LigneAvecStatut>> {
  return [
    {
      cle: 'ingredient',
      libelle: 'Ingrédient',
      largeur: '26%',
      alignement: 'texte',
      // Jamais coupe : « Farine de froment T55 » et « Farine de froment T65 »
      // ne se distinguent que par la fin (`Tableau.tsx`, `troncature`).
      troncature: 'repli',
      rendu: (l) => l.nom,
      titre: (l) => l.nom,
    },
    {
      cle: 'stock',
      libelle: 'Stock',
      largeur: '14%',
      alignement: 'nombre',
      troncature: 'repli',
      rendu: (l) => formaterQuantite(l.quantiteDisponible, l.unite),
    },
    {
      cle: 'valeur',
      // L'unite va dans l'en-tete, jamais repetee en cellule (docs/07 §4.5) :
      // `formaterMontant`, pas `formaterEuros`, qui repeterait « € » sur
      // chaque ligne.
      libelle: 'Valeur (€)',
      largeur: '14%',
      alignement: 'nombre',
      troncature: 'repli',
      rendu: (l) => formaterMontant(l.valeurCents),
    },
    {
      cle: 'seuil',
      libelle: 'Seuil',
      largeur: '14%',
      alignement: 'nombre',
      troncature: 'repli',
      rendu: (l) => formaterQuantite(l.stockSecurite, l.unite),
    },
    {
      cle: 'dlc',
      libelle: 'DLC min',
      // Alignement TEXTE et non NOMBRE : une date est un identifiant qualitatif,
      // pas une grandeur (docs/07 §4.5).
      largeur: '16%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (l) => rendreDlc(l.dlcLaPlusProche, anneeReference, jourReference, horizonDlcJours),
      titre: (l) => ouTiret(l.dlcLaPlusProche, (d) => formaterDate(d)),
    },
    {
      cle: 'statut',
      libelle: 'Statut',
      largeur: '16%',
      alignement: 'texte',
      troncature: 'repli',
      // Meme principe que `statutAfficheLot` : le libelle generique
      // (« Commander ») mentirait sur la VRAIE raison quand c'est la
      // peremption du lot le plus ancien, et non la quantite, qui declenche
      // le depassement — l'utilisateur irait chercher un manque de stock qui
      // n'existe pas.
      rendu: (l) => (
        <PastilleStatut
          statut={l.statut}
          libelle={
            estPerime(l.dlcLaPlusProche, jourReference)
              ? 'Lot périmé'
              : LIBELLE_STATUT_INGREDIENT[l.statut]
          }
        />
      ),
    },
  ];
}

/**
 * Colonnes du detail par lot.
 *
 * « PAYÉ (€) » N'EST PAS UNE COLONNE DE CONFORT. C'est le montant REELLEMENT
 * verse pour ce lot, en centimes entiers — la seule valeur rapprochable de la
 * facture fournisseur au centime pres. Le geste que l'utilisateur fait
 * vraiment, c'est comparer ce que l'application dit a ce que le meunier lui a
 * facture ; sans cette colonne, ce rapprochement n'existe nulle part dans le
 * produit. Le TAUX au gramme (`prixUnitaireCents`, fractionnaire et derive)
 * n'est pas affiche en cellule : il ne figure sur aucun bon de livraison. Il
 * reste utile au cout de revient, pas a l'oeil.
 *
 * `troncature: 'repli'` sur presque toutes les colonnes : le panneau fait
 * 440 px pour six colonnes, et aucune de ces valeurs ne survit a une coupure.
 * Un numero de lot tronque est un rappel de marchandise qu'on ne peut pas
 * effectuer ; un montant tronque par la fin (« 128,4… ») est un montant faux.
 */
function colonnesLots(
  anneeReference: number,
  jourReference: string,
  horizonDlcJours: number | null,
): ReadonlyArray<ColonneTableau<LotAffiche>> {
  return [
    {
      cle: 'lot',
      libelle: 'N° de lot fournisseur',
      largeur: '24%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (l) => ouTiret(l.numeroLotFournisseur, (n) => n),
      titre: (l) => ouTiret(l.numeroLotFournisseur, (n) => n),
    },
    {
      cle: 'reception',
      libelle: 'Reçu le',
      largeur: '12%',
      alignement: 'texte',
      rendu: (l) => formaterDateTableau(l.dateReception, anneeReference),
      titre: (l) => formaterDate(l.dateReception),
    },
    {
      cle: 'dlc',
      libelle: 'DLC',
      largeur: '16%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (l) => rendreDlc(l.dateDlc, anneeReference, jourReference, horizonDlcJours),
      titre: (l) => ouTiret(l.dateDlc, (d) => formaterDate(d)),
    },
    {
      cle: 'restant',
      libelle: 'Reste',
      largeur: '14%',
      alignement: 'nombre',
      troncature: 'repli',
      rendu: (l) => l.restantFormatte,
    },
    {
      cle: 'paye',
      libelle: 'Payé (€)',
      largeur: '16%',
      alignement: 'nombre',
      troncature: 'repli',
      rendu: (l) => l.payeFormatte,
      titre: (l) => l.titrePaye,
    },
    {
      cle: 'statut',
      libelle: 'Statut',
      largeur: '18%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (l) => {
        const { statut, libelle } = statutAfficheLot(l, jourReference);
        return <PastilleStatut statut={statut} libelle={libelle} />;
      },
    },
  ];
}

function messageErreur(erreur: unknown): string {
  return erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
}

export default function Stock() {
  const navigate = useNavigate();
  const [etatStock, setEtatStock] = useState<EtatStockEcran>({ statut: 'chargement' });
  const [ingredientSelectionneId, setIngredientSelectionneId] = useState<string | null>(null);
  const [etatLots, setEtatLots] = useState<EtatLots | null>(null);
  const [mode, setMode] = useState<Mode>('consultation');
  const [sortieOuverte, setSortieOuverte] = useState(false);
  /**
   * Lot ouvert sous le tableau des lots. C'est la porte d'entree des deux
   * gestes rares et critiques du module : la CONTREPASSATION d'un mouvement
   * (seul chemin de correction, CLAUDE.md §3 regle 7) et la MISE EN
   * QUARANTAINE d'un lot (exigence AFSCA motivee dans `schema.ts`). Aucun des
   * deux n'etait atteignable depuis une interface.
   */
  const [lotSelectionneId, setLotSelectionneId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  /**
   * Avertissements de traçabilité de la DERNIÈRE réception (docs/21 §1.4) :
   * un lot identifié par sa seule DLC, sans numéro de lot fournisseur — un
   * point qui compte pour l'AFSCA en cas de rappel (CLAUDE.md §3 règle 6).
   * Affichés TELS QUELS, jamais reformulés (voir `avertissementsReceptionAAfficher`,
   * `@batte/core`) : ce sont des phrases écrites par le serveur. `null` sur
   * une réception qui n'en produit aucun — le cas le plus fréquent, jamais un
   * bandeau « traçabilité correcte » affiché à chaque réception.
   */
  const [avertissementsReception, setAvertissementsReception] = useState<readonly string[] | null>(
    null,
  );
  const [etatIntegrite, setEtatIntegrite] = useState<EtatIntegrite>({ statut: 'inactif' });
  /**
   * Compteur de rechargement. Une ecriture de stock rend obsoletes A LA FOIS le
   * tableau et le panneau de lots : les incrementer ensemble evite un ecran ou
   * la quantite de l'ingredient a bouge mais pas ses lots — c'est-a-dire un
   * ecran qui se contredit lui-meme.
   */
  const [revision, setRevision] = useState(0);
  /**
   * Exercice de l'export des mouvements. Initialise a l'annee courante —
   * l'exercice qu'on exporte neuf fois sur dix — mais modifiable : le
   * comptable reclame parfois l'annee close, et le journal des mouvements est
   * la piece de tracabilite que l'AFSCA peut demander sur un exercice passe.
   * Initialiseur PARESSEUX : `aujourdHui()` doit etre lue a l'ouverture de
   * l'ecran, jamais a l'import du module (voir `lib/dates.ts`).
   */
  const [anneeExport, setAnneeExport] = useState(() =>
    Number.parseInt(aujourdHui().slice(0, 4), 10),
  );
  const panneauDetailRef = useRef<HTMLDivElement>(null);
  /**
   * Conteneur du TABLEAU des ingredients — jamais demonte quand le panneau de
   * detail se ferme, contrairement a `panneauDetailRef` ci-dessus. C'est de la
   * qu'on retrouve la rangee qui avait ouvert le detail, et c'est le repli de
   * dernier recours si elle ne s'y trouve plus (voir `fermerDetailIngredient`).
   *
   * LA PORTEE EST INDISPENSABLE ICI, et c'est ce qui distingue cet ecran des
   * autres : `Stock` monte DEUX grilles — les ingredients, puis les lots de
   * l'ingredient choisi — et les deux peuvent porter en meme temps une rangee
   * `aria-selected="true"`. Un `document.querySelector` global rendrait la
   * bonne rangee par simple hasard d'ordre du document ; la recherche part donc
   * de ce conteneur, qui n'englobe que la premiere grille.
   */
  const conteneurTableauStock = useRef<HTMLDivElement>(null);
  // Le bouton « Sortir du stock… » DISPARAIT quand `sortieOuverte` passe a
  // `true` (remplace par `SaisieSortie`, docs/07 §4.6) : sans cette ref, le
  // focus retombait sur `<body>` a la fermeture (Echap ou `onAnnuler`) au lieu
  // de revenir sur le controle qui l'avait ouvert.
  const boutonSortir = useRef<HTMLButtonElement>(null);
  /**
   * Bouton « Enregistrer une réception » — MEME PATRON que `boutonSortir`
   * ci-dessus, et meme defaut : il DISPARAIT en s'ouvrant (il n'est rendu qu'en
   * mode `consultation`), donc la fermeture du formulaire par « Annuler »
   * demontait le bouton qui detenait le focus et le rendait a `<body>`.
   *
   * `SaisieReception` traitait deja la moitie ALLER de ce defaut — elle prend
   * le focus sur son premier champ des qu'elle devient utilisable, precisement
   * parce que le bouton qui l'ouvre s'efface. La moitie RETOUR manquait : on
   * pouvait entrer dans le formulaire au clavier, jamais en ressortir sans
   * retraverser la navigation laterale (CLAUDE.md §3 regle 10).
   */
  const boutonOuvrirReception = useRef<HTMLButtonElement>(null);
  /**
   * Bouton « Fermer » du panneau de lots (voir son rendu plus bas) — repli
   * STABLE pour `ecritureSurLot` ci-dessous : il existe des que
   * `ingredientSelectionne !== null`, donc que `<DetailLot>` reste monte ou
   * non apres l'ecriture, et meme quand plus rien de focalisable ne subsiste
   * DANS `<DetailLot>` (voir le commentaire de `ecritureSurLot`).
   */
  const boutonFermerPanneauLots = useRef<HTMLButtonElement>(null);

  const jourReference = aujourdHui();
  const anneeReference = Number.parseInt(jourReference.slice(0, 4), 10);

  /**
   * Horizon d'alerte DLC, lu depuis `brief_horizon_alerte_dlc_jours`
   * (correctif « brief vs ecrans », 01/08/2026 — voir le commentaire de
   * `rendreDlc`). AUCUN parametre en revanche pour le seuil de rupture de
   * stock : le stock de securite EST le seuil d'alerte, et il est porte par
   * chaque ingredient — ajouter un pourcentage par-dessus serait un seuil sur
   * un seuil. Les deux notions sont independantes ; seule la premiere a
   * besoin d'un appel reseau ici.
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
        // parametre, `rendreDlc` continue de montrer la date, seul le
        // compteur « J-n » reste absent.
      });

    return () => {
      annule = true;
    };
  }, []);

  useEffect(() => {
    let annule = false;

    requeteApi<unknown>('/stock')
      .then((reponse) => {
        const etat = schemaEtatStock.parse(reponse);
        if (annule) return;
        setEtatStock({
          statut: 'pret',
          lignes: etat.data,
          total: etat.meta.total,
          valeurTotaleCents: etat.meta.valeurTotaleCents,
          nbAReapprovisionner: etat.meta.nbAReapprovisionner,
        });
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        setEtatStock({ statut: 'erreur', message: messageErreur(erreur) });
      });

    return () => {
      annule = true;
    };
  }, [revision]);

  /**
   * Dernier ingredient pour lequel les lots ont ete charges — distingue les
   * DEUX declencheurs de l'effet ci-dessous SANS dupliquer la fonction (meme
   * esprit que `chargerEcheances` / `rechargerEcheancesEnArrierePlan` dans
   * `Comptabilite.tsx`, transpose a un effet garde par deux dependances
   * plutot qu'a deux fonctions appelees separement) :
   *
   *  - un changement d'INGREDIENT SELECTIONNE est un PREMIER chargement pour
   *    ce lot de donnees, rien n'est encore affiche — `'chargement'` est
   *    legitime ;
   *  - un simple bump de `revision`, sur le MEME ingredient, est un
   *    rechargement D'ARRIERE-PLAN declenche depuis l'INTERIEUR meme de
   *    `<DetailLot>` (`ecritureSurLot`, ci-dessous : changement de statut ou
   *    contrepassation). Y repasser par `'chargement'` demontait le
   *    `<Tableau>` des lots ET `<DetailLot>` lui-meme — y compris le bouton
   *    ou le champ qui venait de recevoir l'action — puis les reconstruisait,
   *    faisant retomber le focus sur `<body>` (D-079 / docs/22 §2.1, le
   *    defaut le plus couteux du sweep : chaque correction de lot obligeait a
   *    retraverser le menu lateral avant de pouvoir corriger le lot suivant).
   */
  const dernierIngredientChargeRef = useRef<string | null>(null);

  // Detail des lots de l'ingredient selectionne, charge a chaque changement
  // de selection (meme patron que la fiche detaillee de Recettes.tsx).
  useEffect(() => {
    if (ingredientSelectionneId === null) {
      setEtatLots(null);
      dernierIngredientChargeRef.current = null;
      return;
    }

    let annule = false;
    const premierChargement = dernierIngredientChargeRef.current !== ingredientSelectionneId;
    dernierIngredientChargeRef.current = ingredientSelectionneId;
    if (premierChargement) setEtatLots({ statut: 'chargement' });

    requeteApi<unknown>(`/stock/${ingredientSelectionneId}/lots`)
      .then((reponse) => {
        const liste = schemaListeLots.parse(reponse);
        if (!annule) setEtatLots({ statut: 'pret', lots: liste.data });
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        setEtatLots({ statut: 'erreur', message: messageErreur(erreur) });
      });

    return () => {
      annule = true;
    };
  }, [ingredientSelectionneId, revision]);

  /**
   * FERME le panneau de detail de l'ingredient — bouton « Fermer » ou branche
   * FINALE d'Échap — en rendant le focus a la rangee du tableau qui l'avait
   * ouvert, jamais a `<body>`.
   *
   * DEFAUT REEL corrige le 01/08/2026, et TROISIEME instance du meme motif dans
   * l'application : les deux chemins de fermeture laissaient tomber le focus.
   * Sur `<body>`, les fleches ne font plus rien et la tabulation suivante
   * repart du tout debut du document — il faut retraverser la navigation
   * laterale pour revenir ou l'on etait. C'est exactement l'instant ou l'on
   * reprend la souris, ce que CLAUDE.md §3 regle 10 existe pour eviter, et il
   * tombe au milieu du geste le plus repetitif de l'ecran : ouvrir un
   * ingredient, lire ses lots, refermer, passer au suivant.
   *
   * La rangee est capturee AVANT l'ecriture d'etat, tant que `aria-selected`
   * la designe encore. `Tableau` reutilise le meme noeud DOM d'un rendu a
   * l'autre (cle React stable sur `ingredientId`) et seul le panneau de detail
   * se demonte : le noeud capture est donc toujours valide au moment ou on lui
   * rend le focus. Il reste focalisable meme s'il perd `tabIndex={0}` au
   * profit d'une autre rangee — `Tableau` pose `tabIndex={-1}` sur toutes les
   * autres, ce qui les laisse atteignables PROGRAMMATIQUEMENT.
   *
   * `requestAnimationFrame` et non un `.focus()` immediat : la cible doit
   * d'abord avoir survecu au rendu declenche par `setIngredientSelectionneId`.
   *
   * Repli sur le conteneur si la rangee n'est pas retrouvee. Ce repli est
   * aujourd'hui hors d'atteinte — le panneau ne s'ouvre que pour un ingredient
   * present dans `lignesTriees`, donc rendu — et il se garde quand meme : il ne
   * coute rien, et il redevient atteignable des qu'un filtre s'ajoutera
   * au-dessus du tableau. Mieux vaut un focus imprecis qu'un focus perdu.
   *
   * `useCallback([])` : reference STABLE d'un rendu a l'autre — seuls des `ref`
   * (jamais reactifs) et des `setState` (stables par construction React) sont
   * lus a l'interieur. C'est ce qui permet a l'effet Échap ci-dessous de la
   * lister en dependance sans se reabonner a chaque rendu.
   */
  const fermerDetailIngredient = useCallback((): void => {
    const conteneur = conteneurTableauStock.current;
    const rangeeCourante =
      conteneur?.querySelector<HTMLElement>('tr[aria-selected="true"]') ?? null;
    setSortieOuverte(false);
    setIngredientSelectionneId(null);
    requestAnimationFrame(() => {
      if (rangeeCourante !== null) rangeeCourante.focus();
      else conteneur?.focus();
    });
  }, []);

  /**
   * FERME le detail d'un LOT — branche la PLUS PROFONDE d'Échap — en rendant
   * le focus a la rangee de lot qui l'avait ouvert.
   *
   * MEME DEFAUT que `fermerDetailIngredient` ci-dessus, une couche plus bas, et
   * trouve en cherchant s'il se repetait : `<DetailLot>` se demonte, et tout ce
   * qui y avait le focus — le bouton « Changer le statut… », un champ de
   * motif — le rend a `<body>`. C'est la que ca coute le plus cher : on ferme
   * le detail d'un lot pour passer au lot SUIVANT de la meme liste, et sans ce
   * rappel il faut retraverser la navigation entre chaque lot.
   *
   * Portee sur `panneauDetailRef` et non sur `conteneurTableauStock` : ce
   * conteneur-ci n'englobe QUE la grille des lots (celle des ingredients est sa
   * soeur), et `<DetailLot>` n'a aucune rangee `aria-selected` — la recherche
   * ne peut donc designer que la rangee de lot cherchee.
   *
   * Repli sur le bouton « Fermer » du panneau de lots, pour la meme raison que
   * `ecritureSurLot` plus bas : c'est le seul element STABLE de ce panneau, il
   * existe des qu'un ingredient est selectionne, et il appartient au meme
   * panneau que celui qui vient d'agir — jamais une cible fabriquee.
   */
  const fermerDetailLot = useCallback((): void => {
    const rangeeCourante =
      panneauDetailRef.current?.querySelector<HTMLElement>('tr[aria-selected="true"]') ?? null;
    setLotSelectionneId(null);
    requestAnimationFrame(() => {
      if (rangeeCourante !== null) rangeeCourante.focus();
      else boutonFermerPanneauLots.current?.focus();
    });
  }, []);

  // « Échap ferme » (docs/07 §4.6) : le panneau n'est pas une modale, rien
  // n'y capture le focus, mais le raccourci de fermeture doit rester
  // disponible comme partout ailleurs dans le produit.
  //
  // EXCEPTION ASSUMEE : en mode `reception`, Échap ne ferme rien. Le
  // formulaire porte alors une saisie recopiee d'un bon de livraison papier ;
  // la perdre sur une touche effleuree couterait bien plus cher que le confort
  // du raccourci. La sortie se fait par « Annuler », explicite.
  useEffect(() => {
    if (mode === 'reception') return;
    if (ingredientSelectionneId === null) return;

    function surAppuiTouche(evenement: KeyboardEvent): void {
      if (evenement.key !== 'Escape') return;
      // Une seule couche a la fois, de la plus profonde a la plus haute : le
      // detail d'un lot, puis la saisie de sortie, puis le panneau. Fermer
      // trois couches d'un coup ferait disparaitre un ecran entier sur une
      // touche effleuree.
      if (lotSelectionneId !== null) {
        // Rend le focus a la rangee du LOT — voir `fermerDetailLot` ci-dessus.
        fermerDetailLot();
        return;
      }
      if (sortieOuverte) {
        setSortieOuverte(false);
        requestAnimationFrame(() => boutonSortir.current?.focus());
        return;
      }
      // Rend le focus a la rangee du tableau, jamais a `<body>` — voir
      // `fermerDetailIngredient` ci-dessus.
      fermerDetailIngredient();
    }

    window.addEventListener('keydown', surAppuiTouche);
    return () => window.removeEventListener('keydown', surAppuiTouche);
  }, [
    fermerDetailIngredient,
    fermerDetailLot,
    ingredientSelectionneId,
    lotSelectionneId,
    mode,
    sortieOuverte,
  ]);

  const rafraichir = useCallback(() => setRevision((precedent) => precedent + 1), []);

  /**
   * Le detail s'ouvre SOUS le tableau : avec vingt ingredients il naitrait hors
   * champ, et le clic n'aurait aucun effet visible. `block: 'nearest'` ne
   * defile que si c'est necessaire — quand le panneau est deja visible, rien ne
   * bouge, et l'ecran ne saute pas sous les doigts a chaque selection.
   */
  useEffect(() => {
    if (ingredientSelectionneId === null) return;
    panneauDetailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [ingredientSelectionneId]);

  const ingredientSelectionne =
    etatStock.statut === 'pret'
      ? (etatStock.lignes.find((l) => l.ingredientId === ingredientSelectionneId) ?? null)
      : null;

  const lignesTriees: LigneAvecStatut[] =
    etatStock.statut === 'pret'
      ? etatStock.lignes
          .map((l) => ({ ...l, statut: statutLigne(l, jourReference) }))
          .sort(comparerLignes)
      : [];

  const lotsAffiches: LotAffiche[] =
    etatLots !== null && etatLots.statut === 'pret' && ingredientSelectionne !== null
      ? etatLots.lots.map((lot) => ({
          ...lot,
          restantFormatte: formaterQuantite(lot.quantiteRestante, ingredientSelectionne.unite),
          payeFormatte: formaterMontant(lot.prixLigneCents),
          // La phrase de rapprochement : « 128,40 € pour 25,0 kg ». Elle
          // COMMENCE par le texte rendu dans la cellule, comme l'exige
          // `Tableau.tsx` pour les infobulles.
          titrePaye: `${formaterEuros(lot.prixLigneCents)} pour ${formaterQuantite(
            lot.quantiteInitiale,
            ingredientSelectionne.unite,
          )}`,
        }))
      : [];

  const lotSelectionne = lotsAffiches.find((l) => l.id === lotSelectionneId) ?? null;

  // Voir `valorisationLots` ci-dessus : recalcule EXPLOITABLE/PÉRIMÉE sur les
  // lots déjà reçus par ce panneau, jamais un second appel réseau.
  const valorisation =
    etatLots !== null && etatLots.statut === 'pret'
      ? valorisationLots(etatLots.lots, jourReference)
      : null;

  // Cliquer la ligne deja selectionnee referme le panneau : un clic ouvre,
  // le meme clic referme, sans bouton dedie a chercher.
  function selectionnerIngredient(ligne: LigneAvecStatut): void {
    setSortieOuverte(false);
    setLotSelectionneId(null);
    setIngredientSelectionneId((precedent) =>
      precedent === ligne.ingredientId ? null : ligne.ingredientId,
    );
  }

  /** Meme convention que le tableau du dessus : le meme clic ouvre et referme. */
  function selectionnerLot(ligne: LotAffiche): void {
    setLotSelectionneId((precedent) => (precedent === ligne.id ? null : ligne.id));
  }

  /**
   * Une ecriture faite depuis le detail d'un lot (contrepassation, changement
   * de statut, annulation de la reception d'origine) change le stock de
   * l'ingredient ET la liste de ses lots : on recharge les deux, sinon l'ecran
   * se contredirait lui-meme. Le lot reste ouvert — on vient d'agir dessus, le
   * refermer obligerait a le rouvrir pour verifier le resultat.
   *
   * PAS DE `.focus()` VERS L'INTERIEUR DE `<DetailLot>` ICI : `appliquerStatut`
   * et `contrepasser` (`DetailLot.tsx`) reposent deja eux-memes le focus sur
   * leur propre bouton bascule ou sur le prochain mouvement corrigeable
   * (`boutonChangerStatutRef`, `cleMouvementAFocaliserApresContrepassation`),
   * APRES avoir appele `onEcriture` (donc APRES le `requestAnimationFrame`
   * ci-dessous — les deux s'executent dans le MEME frame, dans l'ordre ou ils
   * ont ete programmes, celui-ci EN PREMIER : la cible plus precise gagne
   * toujours, sans rien coordonner explicitement).
   *
   * LE REPLI GENERAL CI-DESSOUS, LUI, EST NECESSAIRE — DEFAUT CORRIGE (audit du
   * 31/07/2026), et ce n'est PAS le defaut du demontage qu'on pourrait croire
   * resolu par la correction du filtre de `/stock/:id/lots`
   * (`apps/api/src/routes/stock.ts`, D-083) : meme lot toujours visible,
   * `annulerLaReception` (`DetailLot.tsx`) ne repose ELLE-MEME aucun focus en
   * cas de succes, et pour une bonne raison verifiee — une fois la reception
   * annulee, `BlocAnnulation` n'affiche plus qu'une PHRASE de blocage
   * (`blocageAnnulationReception`, `annulation.ts`) a la place du bouton qui
   * avait le focus : il ne reste rien A l'interieur du bloc reception vers
   * quoi revenir, que `<DetailLot>` survive ou non. Le focus se perd de plus
   * DEUX FOIS : `disabled={enCours}` (`BlocAnnulation.tsx`) fait deja lacher
   * le bouton de confirmation par le navigateur des le clic, AVANT meme la
   * reponse reseau — le meme patron general qui a deja coute deux ecrans,
   * distinct du demontage. Repli sur le bouton « Fermer » du panneau de lots
   * (voir son rendu plus bas) : seul element STABLE, present que le lot
   * survive (quarantaine, blocage) ou disparaisse de la liste, et donc le
   * seul choix qui ne soit pas une cible inventee (meme discipline que
   * l'echeancier de `Comptabilite.tsx`, D-079 — jamais de repli fabrique
   * quand aucune cible naturelle ne subsiste, MAIS celui-ci EST naturel : il
   * appartient au meme panneau que celui qui vient d'agir).
   */
  function ecritureSurLot(message: string): void {
    requestAnimationFrame(() => boutonFermerPanneauLots.current?.focus());
    setConfirmation(message);
    // Cette confirmation-ci ne vient pas d'une réception : l'avertissement de
    // traçabilité de la précédente n'a plus lieu d'être affiché à côté d'une
    // action sans rapport.
    setAvertissementsReception(null);
    rafraichir();
  }

  /**
   * Declenche le controle d'integrite du grand livre de stock, A LA DEMANDE
   * de l'utilisateur — c'est le seul chemin de production qui appelle ce
   * controle (voir `apps/api/src/routes/stock.ts`). Le verdict est rendu tel
   * quel, coherent ou non : ni l'un ni l'autre n'est tu.
   */
  async function verifierIntegrite(): Promise<void> {
    setEtatIntegrite({ statut: 'en_cours' });
    try {
      const resultat = schemaDiagnosticIntegriteStock.parse(
        await requeteApi<unknown>('/stock/integrite'),
      );
      setEtatIntegrite({ statut: 'fait', resultat });
    } catch (erreur) {
      // CLAUDE.md §4 : jamais de `catch` silencieux.
      setEtatIntegrite({ statut: 'erreur', message: messageErreur(erreur) });
    }
  }

  function ouvrirReception(): void {
    setConfirmation(null);
    setAvertissementsReception(null);
    setSortieOuverte(false);
    setLotSelectionneId(null);
    setIngredientSelectionneId(null);
    setMode('reception');
  }

  /**
   * NE REFERME PLUS le formulaire (recette clavier du 30/07/2026 : sans ce
   * changement, `SaisieReception` se demontait ici meme, et le focus qu'elle
   * venait de reprendre sur son premier champ retombait aussitot sur
   * `<body>`). `SaisieReception` s'est deja videe et a deja repris le focus
   * elle-meme (`reinitialiserFormulaire`) avant d'appeler ce gestionnaire :
   * rester en mode `reception` est ce qui rend cette reprise de focus
   * VISIBLE — le porteur enchaine les receptions, un fournisseur different
   * livrant parfois le meme jour. « Annuler », dans le formulaire, reste le
   * chemin explicite pour revenir a la consultation.
   */
  function receptionEnregistree(resultat: ReceptionEnregistree): void {
    // « Voir laquelle » (mission « boucle d'achat », 30/07/2026) : la
    // confirmation redit désormais quelle commande vient d'être soldée par
    // cette réception — `null` quand aucune commande n'était rattachée, et
    // alors rien n'est ajouté (voir `mentionCommandeSoldee`, `@batte/core`).
    const commande = mentionCommandeSoldee(resultat.commandeNumero);
    setConfirmation(
      `Réception ${resultat.numero} enregistrée — ${libelleLots(resultat.nbLots)} créé${
        resultat.nbLots > 1 ? 's' : ''
      }, ${formaterEuros(resultat.montantTotalCents)}.${commande === null ? '' : ` ${commande}`}`,
    );
    setAvertissementsReception(avertissementsReceptionAAfficher(resultat.avertissements));
    rafraichir();
  }

  function sortieEnregistree(resultat: SortieEnregistree): void {
    setSortieOuverte(false);
    requestAnimationFrame(() => boutonSortir.current?.focus());
    setConfirmation(
      `Sortie enregistrée — ${resultat.nbMouvements} mouvement${
        resultat.nbMouvements > 1 ? 's' : ''
      } en FEFO, ${formaterEuros(resultat.coutTotalCents)} de matière.`,
    );
    // Cette confirmation-ci ne vient pas d'une réception : voir `ecritureSurLot`.
    setAvertissementsReception(null);
    rafraichir();
  }

  return (
    <div className="flex flex-col gap-bloc">
      <div className="flex h-rangee items-center justify-between">
        <h1 className="text-lg text-ink">Stock</h1>
        {mode === 'consultation' && (
          <button
            type="button"
            ref={boutonOuvrirReception}
            onClick={ouvrirReception}
            className={CLASSE_BOUTON_PRIMAIRE}
          >
            Enregistrer une réception
          </button>
        )}
      </div>

      {confirmation !== null && <BandeauSucces>{confirmation}</BandeauSucces>}

      {/* Avertissement de traçabilité de la dernière réception (docs/21 §1.4)
          — un lot identifié par sa seule DLC, sans numéro de lot fournisseur.
          Affiché TEL QUEL (voir `avertissementsReceptionAAfficher`,
          `@batte/core`), une phrase par lot concerné, jamais reformulé.
          `null` (donc rien à l'écran) sur une réception qui n'en produit
          aucun — le cas le plus fréquent. */}
      {avertissementsReception !== null && (
        <BandeauAlerte>
          {avertissementsReception.map((avertissement, index) => (
            <p key={index} className={index > 0 ? 'mt-groupe' : undefined}>
              <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span> {avertissement}
            </p>
          ))}
        </BandeauAlerte>
      )}

      {mode === 'reception' && (
        <SaisieReception
          variante="reception"
          onEnregistre={receptionEnregistree}
          onAnnuler={() => {
            setMode('consultation');
            // Le bouton vise ne renait qu'au prochain rendu, d'ou le
            // `requestAnimationFrame` — meme patron que `boutonSortir`.
            requestAnimationFrame(() => boutonOuvrirReception.current?.focus());
          }}
        />
      )}

      {mode === 'consultation' && (
        <>
          {/* Les deux exports vivent sur la ligne de synthèse du stock, pas
              dans un menu séparé : on exporte l'état qu'on vient de lire.
              L'état du stock est daté d'aujourd'hui par le serveur et ne
              demande donc rien ; le journal des mouvements, lui, porte sur un
              EXERCICE, d'où le seul champ de cette barre. */}
          {etatStock.statut === 'pret' && (
            <div className="flex flex-wrap items-center justify-between gap-bloc">
              {etatStock.total > 0 ? (
                <p className="text-sm text-ink-2">
                  Valeur totale :{' '}
                  <span className="font-medium text-ink">
                    {formaterEuros(etatStock.valeurTotaleCents)}
                  </span>{' '}
                  — {etatStock.nbAReapprovisionner}{' '}
                  {etatStock.nbAReapprovisionner <= 1
                    ? 'ingrédient à réapprovisionner'
                    : 'ingrédients à réapprovisionner'}
                  .
                </p>
              ) : (
                <span />
              )}

              <div className="flex flex-wrap items-start gap-bloc">
                <BoutonDocument
                  chemin="/exports/stock"
                  libelle="État du stock (Excel)"
                  libelleAttente="Export en cours…"
                />
                <label
                  className="flex h-controle items-center gap-groupe text-sm text-ink-2"
                  htmlFor="stock-annee-mouvements"
                >
                  Exercice
                  <input
                    id="stock-annee-mouvements"
                    type="number"
                    className="num h-controle w-24 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                    value={anneeExport}
                    onChange={(evenement) => {
                      const valeur = Number.parseInt(evenement.target.value, 10);
                      if (Number.isInteger(valeur)) setAnneeExport(valeur);
                    }}
                  />
                </label>
                <BoutonDocument
                  chemin={`/exports/mouvements?annee=${anneeExport}`}
                  libelle="Mouvements de stock (Excel)"
                  libelleAttente="Export en cours…"
                />
                {/* Controle d'integrite du grand livre de stock (voir
                    `verifierIntegrite` ci-dessus) : le controle sur lequel
                    repose la credibilite du registre AFSCA, jusqu'ici
                    invocable seulement par ses propres tests. */}
                <button
                  type="button"
                  onClick={() => void verifierIntegrite()}
                  aria-disabled={etatIntegrite.statut === 'en_cours'}
                  aria-busy={etatIntegrite.statut === 'en_cours'}
                  className={`${CLASSE_BOUTON_SECONDAIRE} ${
                    etatIntegrite.statut === 'en_cours' ? 'cursor-not-allowed opacity-60' : ''
                  }`}
                >
                  {etatIntegrite.statut === 'en_cours'
                    ? 'Vérification…'
                    : "Vérifier l'intégrité du stock"}
                </button>
              </div>
            </div>
          )}

          {etatIntegrite.statut === 'fait' && etatIntegrite.resultat.coherent && (
            <BandeauSucces>
              Stock cohérent — {etatIntegrite.resultat.nbLotsVerifies} lot
              {etatIntegrite.resultat.nbLotsVerifies <= 1 ? '' : 's'} vérifié
              {etatIntegrite.resultat.nbLotsVerifies <= 1 ? '' : 's'}.
            </BandeauSucces>
          )}

          {etatIntegrite.statut === 'fait' && !etatIntegrite.resultat.coherent && (
            <BandeauErreur
              message={`Incohérence détectée sur ${etatIntegrite.resultat.lotsFautifs.length} lot(s) sur ${etatIntegrite.resultat.nbLotsVerifies} vérifié(s) : ${etatIntegrite.resultat.lotsFautifs
                .map((l) => `lot ${l.lotId} (reste ${l.restant} pour ${l.quantiteInitiale} reçu)`)
                .join(', ')}.`}
            />
          )}

          {etatIntegrite.statut === 'erreur' && <MessageErreur message={etatIntegrite.message} />}

          {etatStock.statut === 'chargement' && (
            <p className="text-sm text-ink-3">Chargement du stock…</p>
          )}

          {etatStock.statut === 'erreur' && <MessageErreur message={etatStock.message} />}

          {etatStock.statut === 'pret' && (
            <div className="flex flex-col gap-bloc">
              {/* `ref` + `tabIndex={-1}` : c'est depuis ce conteneur que
                  `fermerDetailIngredient` retrouve la rangee a refocaliser, et
                  c'est lui-meme le repli si elle est introuvable —
                  programmatique uniquement, jamais dans l'ordre de tabulation
                  normal. */}
              <div ref={conteneurTableauStock} tabIndex={-1} className="min-w-0">
                <Panneau titre={`${etatStock.total} ingrédients`} sansRembourrage>
                  <Tableau
                    colonnes={colonnesStock(anneeReference, jourReference, horizonDlcJours)}
                    lignes={lignesTriees}
                    cleLigne={(l) => l.ingredientId}
                    {...(ingredientSelectionneId !== null
                      ? { ligneSelectionneeCle: ingredientSelectionneId }
                      : {})}
                    onSelectionnerLigne={selectionnerIngredient}
                    etatVide={
                      <EtatVide
                        variante="premier-lancement"
                        titre="Aucun stock enregistré"
                        explication="Aucune réception ni aucun inventaire n'a encore été saisi : il n'existe encore aucun lot à suivre."
                        action={{
                          libelle: 'Saisir un inventaire initial',
                          onClick: () => navigate('/stock/inventaire'),
                        }}
                      />
                    }
                  />
                  {horizonDlcJours !== null && lignesTriees.length > 0 && (
                    // Meme fenetre que le brief avant-marche, et annoncee de la
                    // meme façon (« Lots à moins de N jours de leur DLC ») :
                    // un chiffre sans sa fenetre est incomparable (mission
                    // « brief vs ecrans », 01/08/2026).
                    <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
                      Le compteur « J-n » sous la DLC s'affiche à moins de {horizonDlcJours} jour
                      {horizonDlcJours > 1 ? 's' : ''} de l'échéance — même fenêtre que le brief
                      avant-marché.
                    </p>
                  )}
                </Panneau>
              </div>

              {ingredientSelectionne !== null && (
                <div ref={panneauDetailRef} className="min-w-0">
                  <Panneau
                    titre={`${ingredientSelectionne.nom} — ${libelleLots(ingredientSelectionne.nbLots)}`}
                    sansRembourrage
                  >
                    <div className="flex items-center justify-between border-b border-line px-4 py-2">
                      <p className="text-xs text-ink-3">
                        Disponible{' '}
                        {formaterQuantite(
                          ingredientSelectionne.quantiteDisponible,
                          ingredientSelectionne.unite,
                        )}
                        {' · '}
                        Total{' '}
                        {formaterQuantite(
                          ingredientSelectionne.quantiteTotale,
                          ingredientSelectionne.unite,
                        )}
                        {valorisation !== null && (
                          <>
                            {' · '}
                            <span
                              title={
                                'Recalculée sur les lots ci-dessous : exclut la matière détruite et ' +
                                'périmée — la même règle que la colonne « Valeur (€) » ci-dessus.'
                              }
                            >
                              Valeur exploitable{' '}
                              <span className="font-medium text-ink">
                                {formaterEuros(valorisation.exploitableCents)}
                              </span>
                            </span>
                            {valorisation.perimeeCents > 0 && (
                              <span className="text-alerte">
                                {' — '}
                                <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span>{' '}
                                {formaterEuros(valorisation.perimeeCents)} de matière périmée non
                                comptés (traçable, pas perdus)
                              </span>
                            )}
                          </>
                        )}
                      </p>
                      {/* Ce bouton se demonte AVEC le panneau qu'il ferme : le
                          focus qu'il detient au moment du clic tomberait sur
                          `<body>` sans le rappel de focus de
                          `fermerDetailIngredient`. */}
                      <button
                        type="button"
                        ref={boutonFermerPanneauLots}
                        onClick={fermerDetailIngredient}
                        className={`text-xs ${CLASSE_BOUTON_LIEN}`}
                      >
                        Fermer
                      </button>
                    </div>

                    {etatLots !== null && etatLots.statut === 'chargement' && (
                      <p className="px-4 py-2 text-sm text-ink-3">Chargement des lots…</p>
                    )}

                    {etatLots !== null && etatLots.statut === 'erreur' && (
                      <MessageErreur message={etatLots.message} />
                    )}

                    {etatLots !== null && etatLots.statut === 'pret' && (
                      <>
                        <Tableau
                          colonnes={colonnesLots(anneeReference, jourReference, horizonDlcJours)}
                          lignes={lotsAffiches}
                          cleLigne={(l) => l.id}
                          {...(lotSelectionneId !== null
                            ? { ligneSelectionneeCle: lotSelectionneId }
                            : {})}
                          onSelectionnerLigne={selectionnerLot}
                          etatVide={
                            <EtatVide
                              variante="normal"
                              texte="Aucun lot enregistré pour cet ingrédient."
                            />
                          }
                        />

                        {/* Le detail du lot s'ouvre SOUS ses lots, dans le MEME
                            panneau, separe par un filet — jamais un panneau
                            imbrique (docs/07 §4.8 : profondeur maximale 1). On
                            y trouve le statut du lot et son historique de
                            mouvements, donc les deux gestes de correction. */}
                        {/* Sans cette ligne, rien n'indique que les rangees
                            de lots sont cliquables — et les deux gestes de
                            correction resteraient introuvables, ce qui serait
                            la meme panne sous une autre forme. */}
                        {lotSelectionne === null && lotsAffiches.length > 0 && (
                          <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
                            Sélectionnez un lot pour lire ses mouvements, corriger une erreur de
                            saisie ou le mettre en quarantaine.
                          </p>
                        )}

                        {lotSelectionne !== null && (
                          <div className="border-t border-line-strong">
                            <DetailLot
                              lot={lotSelectionne}
                              nomIngredient={ingredientSelectionne.nom}
                              unite={ingredientSelectionne.unite}
                              onEcriture={ecritureSurLot}
                            />
                          </div>
                        )}
                      </>
                    )}

                    {/* Sortie de correction. Elle vit ICI, sous les lots, et
                        non dans un ecran separe : on saisit en voyant l'ordre
                        FEFO que le serveur va suivre. Separateur en filet
                        pleine largeur, jamais un second panneau
                        (docs/07 §4.8 : profondeur maximale 1). */}
                    <div className="border-t border-line-strong">
                      {sortieOuverte ? (
                        <SaisieSortie
                          ingredientId={ingredientSelectionne.ingredientId}
                          nomIngredient={ingredientSelectionne.nom}
                          unite={ingredientSelectionne.unite}
                          quantiteDisponible={ingredientSelectionne.quantiteDisponible}
                          onEnregistre={sortieEnregistree}
                          onAnnuler={() => {
                            setSortieOuverte(false);
                            requestAnimationFrame(() => boutonSortir.current?.focus());
                          }}
                        />
                      ) : (
                        <div className="flex items-center justify-between px-4 py-2">
                          <span className="text-xs text-ink-3">
                            Casse, don, consommation personnelle, écart d’inventaire
                          </span>
                          <button
                            type="button"
                            ref={boutonSortir}
                            onClick={() => {
                              setConfirmation(null);
                              setSortieOuverte(true);
                            }}
                            className={CLASSE_BOUTON_LIEN}
                          >
                            Sortir du stock…
                          </button>
                        </div>
                      )}
                    </div>
                  </Panneau>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
