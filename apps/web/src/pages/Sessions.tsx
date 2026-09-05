import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ErreurMetier,
  FUSEAU,
  GLYPHE_STATUT,
  LIBELLE_ECOULEMENT,
  LIBELLE_ECOULEMENT_LONG,
  TIRET_ABSENT,
  convertir,
  ecartProduction,
  electriciteDisponibleLieu,
  formaterDate,
  formaterDateHeure,
  formaterEcartMontant,
  formaterEuros,
  formaterMontant,
  formaterPourcent,
  formaterQuantite,
  ouTiret,
  parserEuros,
  ratioEnPointsDeBase,
  rapprocherCaisse,
  resoudreCrepesDepuisVolumeRestant,
  schemaCommentaireIa,
  schemaLieuMarche,
  schemaListeEquipements,
  schemaListeLieuxComplets,
  schemaListeOpportunites,
  schemaListeProductions,
  schemaListeSessions,
  schemaProduitVendable,
  schemaResultatCloture,
  schemaSessionDetail,
  schemaTableauSeuils,
  titreEcoulement,
  totaliserVentes,
  type ClotureSession,
  type CommentaireIa,
  type CompteurSeuilContrat,
  type EcartStockVente,
  type Equipement,
  type FacturationElectricite,
  type FraisSessionLigneContrat,
  type ImputationDeplacementContrat,
  type LieuMarcheContrat,
  type LigneOpportunite,
  type LigneVente,
  type MeteoSessionReleve,
  type ProductionResume,
  type ProductionSession,
  type ProduitVendable,
  type ResolutionCrepesParVolume,
  type ResolutionVolumeContrat,
  type SessionDetail,
  type SessionResume,
  type Statut,
  type TableauSeuils,
} from '@batte/core';
import { BoutonDocument } from '../composants/BoutonDocument';
import { PastilleStatut } from '../composants/affichage';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { MessageErreur, natureDuRefus, type NatureRefus } from '../composants/EncartErreur';
import { ErreurApi, requeteApi } from '../lib/api';
import { aujourdHui } from '../lib/dates';
import { CLASSE_BOUTON_LIEN } from '../saisie-stock/champs';
import { compteAccorde } from './pluriel';

/**
 * Écran Sessions (Lot 4 — docs/06 §3 « Clôture de session »).
 *
 * C'EST L'ÉCRAN LE PLUS IMPORTANT DU PRODUIT : utilisé un dimanche soir à 21 h,
 * après six heures debout, une cinquantaine de fois par an. Tout au clavier
 * (CLAUDE.md §3, docs/07 §4.6, décision D-017 — mode TABLEUR et non grille
 * ARIA sur CET écran précisément).
 *
 * Règle d'architecture n°1 (CLAUDE.md §3) : ce composant n'effectue AUCUN
 * calcul métier PERSISTANT. Les totaux affichés PENDANT LA SAISIE (total de
 * ligne, total général, écart de caisse, cohérence produites/vendues/
 * invendues/cassées, taux d'écoulement) sont de l'AIDE À LA FRAPPE : ils
 * passent tous par les fonctions pures déjà exportées par `@batte/core`
 * (`totaliserVentes`, `rapprocherCaisse`, `ecartProduction`,
 * `ratioEnPointsDeBase`) — jamais une formule réécrite ici. À la clôture,
 * c'est le `SessionDetail` renvoyé par le serveur qui fait foi : la marge, le
 * coût matière réel et la commission carte ne sont JAMAIS recalculés côté
 * client, ils viennent tels quels de la réponse HTTP.
 *
 * Structure (docs/06 §3) : VENTES (tableau éditable) · CAISSE (fonds,
 * espèces comptées, SumUp, écart en direct) · PRODUCTION (produit / vendu /
 * invendu / cassé / taux d'écoulement) · FRAIS · ÉQUIPEMENTS ÉLECTRIQUES
 * (fiche 17 — durée d'utilisation par appareil, masqué sur un lieu qui n'a
 * aucune électricité, D-055) · TEMPÉRATURES. Plus : la liste des sessions
 * avec CA/marge/écoulement/écart caisse, et un bloc seuils légaux avec
 * projection de fin d'année (l'alerte porte sur la TRAJECTOIRE, jamais sur
 * le pourcentage instantané).
 *
 * Clavier — mode TABLEUR (décision D-017), pas grille ARIA :
 *  - chaque champ de quantité est un vrai `<input>` dans le flux de
 *    tabulation ; `Tab` = champ suivant est donc entièrement NATIF (ordre du
 *    DOM), aucun code n'intercepte `Tab` sur cet écran ;
 *  - `Entrée` DESCEND TOUJOURS vers le champ Quantité de la ligne suivante,
 *    quelle que soit la ligne (catalogue ou libre), en créant une ligne libre
 *    si on est sur la dernière. Choix délibéré : chaque ligne a TOUJOURS un
 *    produit valide (les lignes du catalogue sont fixes ; une ligne libre
 *    naît avec le premier produit vendable déjà sélectionné), donc « le
 *    champ Quantité » est systématiquement le point d'arrivée logique — c'est
 *    la généralisation de la règle « le focus part automatiquement sur le
 *    premier champ de quantité à l'ouverture » à CHAQUE nouvelle ligne, pas
 *    seulement à la première ;
 *  - `Ctrl+S` clôture (= enregistre : la maquette de docs/06 n'affiche qu'un
 *    seul bouton, « Enregistrer », il n'y a pas de brouillon séparé de la
 *    clôture — voir le rapport de livraison pour le manque de contrat que
 *    cela révèle) ; `preventDefault()` empêche Chrome d'ouvrir sa boîte de
 *    dialogue native.
 */

/* Date du jour lue à chaque appel, jamais figée à l'import : voir `aujourdHui`
   dans `lib/dates.ts`. */

/* ═══════════════════════════════════════════════════════════════════════════
   Présentation partagée (statuts, formats) — mêmes conventions que
   Production.tsx et Stock.tsx : glyphe + couleur, jamais la couleur seule
   (docs/07 §4.5, tableaux imprimés en PDF chez le comptable et à l'AFSCA).
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Table de couleurs des trois statuts (docs/07 §4.5) — conservée LOCALEMENT
 * (contrairement à `PastilleStatut`, désormais importée de
 * `composants/affichage.tsx`) parce qu'un second usage, hors de cette
 * pastille, en a besoin directement : la colonne « Réalisé / plafond » des
 * seuils légaux (`COLONNES_SEUILS` plus bas) colore le texte de la tolérance
 * E604 bis sans passer par un `<PastilleStatut>` complet (pas de glyphe
 * répété sur une même ligne déjà porteuse d'un glyphe de seuil).
 */
const CLASSE_TEXTE_STATUT: Readonly<Record<Statut, string>> = {
  depassement: 'text-depassement',
  alerte: 'text-alerte',
  conforme: 'text-conforme',
};

const LIBELLE_STATUT_SESSION: Readonly<Record<SessionResume['statut'], string>> = {
  planifiee: 'Planifiée',
  cloturee: 'Clôturée',
  annulee: 'Annulée',
};

/**
 * Raison, en français, pour laquelle l'analyse d'écart Claude n'est PAS
 * disponible sur cette session — `undefined` si elle l'est (mission du
 * 31/07/2026, même motif que D-087 — « une capacité existe, testée, aucun
 * écran ne l'appelle » — appliqué ici à `POST /ia/analyse-ecart/:id`, testée,
 * avec ses garde-fous, et n'était appelée par AUCUN écran).
 *
 * Même garde-fou que `BoutonDocument` pour le rapport de session juste
 * au-dessus dans le panneau « Détail de la session » : ce panneau ne s'ouvre
 * que pour une session `cloturee` ou `annulee` (voir le commentaire de
 * `ouvrirLectureSeule` — les deux autres statuts partent vers le formulaire de
 * clôture), donc `annulee` est le seul cas réellement atteignable ici. La
 * route `/ia/analyse-ecart/:id` (`apps/api/src/routes/ia.ts`) refuse tout
 * statut différent de `cloturee` avec exactement ce message — l'annoncer
 * avant le clic évite de faire découvrir la règle par un 422.
 *
 * Fonction PURE et exportée (CLAUDE.md §7 : ni `jsdom` ni
 * `@testing-library/react` dans ce dépôt, `vitest.config.ts`) : prouve le
 * texte affiché sans monter l'écran.
 */
export function raisonIndisponibleAnalyseEcart(
  statut: SessionResume['statut'],
): string | undefined {
  if (statut === 'cloturee') return undefined;
  return `Cette session est en statut « ${LIBELLE_STATUT_SESSION[statut]} » : l'analyse d'écart n'est disponible qu'après clôture.`;
}

/**
 * `en_cours` se lit comme une alerte (le marché est commencé, la clôture
 * reste due), clôturée comme conforme, annulée — écriture d'annulation,
 * jamais une suppression (docs/07 §1.4) — comme un dépassement. Même
 * principe que `statutAffichageProduction` dans Production.tsx : un mappage
 * fixe, aucun calcul.
 *
 * `planifiee` n'a délibérément PAS d'entrée ici — voir `affichageStatutSession`
 * juste en dessous. Une session future n'est ni conforme, ni une alerte, ni
 * un dépassement ; l'exclure du type d'entrée (`Exclude<..., 'planifiee'>`)
 * force chaque appelant à traiter ce cas à part, au lieu de le laisser
 * retomber en silence sur `'alerte'` — exactement le défaut relevé par
 * l'audit visuel du 30/07/2026 (`docs/23-AUDIT-VISUEL.md` §3.2) : le glyphe
 * ▲ des vraies alertes (rupture de stock, DLC proche) réutilisé pour un
 * futur normal, qui ne nécessite aucune action, dilue le seul signal qui
 * doit rester rare (docs/07 §3.5).
 */
function statutAffichageSession(statut: Exclude<SessionResume['statut'], 'planifiee'>): Statut {
  switch (statut) {
    // `'en_cours'` retiré le 01/08/2026 avec l'état lui-même : il n'était
    // écrit par aucun chemin, et ne pouvait pas l'être — `CLAUDE.md` §1 pose
    // « aucun usage sur le stand pendant le marché ». Cette branche rendait
    // donc `'alerte'` pour une situation impossible.
    case 'cloturee':
      return 'conforme';
    case 'annulee':
      return 'depassement';
  }
}

/**
 * Décision d'affichage du statut d'une session. `planifiee` est un cas
 * NEUTRE — ni conforme, ni alerte, ni dépassement — jamais un quatrième
 * membre de `Statut` : le vocabulaire de `GLYPHE_STATUT`
 * (`packages/core/src/affichage.ts`) reste fermé à trois entrées par
 * décision de conception ; en ajouter une ici serait une décision
 * d'architecture à faire valider, pas à prendre dans un correctif de
 * libellé. Le précédent existe déjà plus bas dans ce fichier : la colonne
 * « Projection fin d'année » rend `projectionFinAnneeCents === null` en
 * texte `text-ink-3` SANS glyphe ni `PastilleStatut`, plutôt que d'inventer
 * un quatrième statut.
 *
 * Exportée pure pour être testée sans monter l'écran (ni `jsdom` ni
 * `@testing-library/react` ne sont installés, CLAUDE.md §7) — voir
 * `Sessions.test.tsx`.
 */
export function affichageStatutSession(
  statut: SessionResume['statut'],
): { readonly neutre: true } | { readonly neutre: false; readonly statut: Statut } {
  if (statut === 'planifiee') return { neutre: true };
  return { neutre: false, statut: statutAffichageSession(statut) };
}

/**
 * Pastille de statut d'une session : glyphe + couleur pour les trois états
 * réels (`PastilleStatut`), texte neutre SANS glyphe pour `planifiee` — un
 * futur normal ne doit jamais porter le ▲ des vraies alertes (voir
 * `affichageStatutSession` ci-dessus).
 */
export function PastilleStatutSession({ statut }: { statut: SessionResume['statut'] }) {
  const libelle = LIBELLE_STATUT_SESSION[statut];
  const affichage = affichageStatutSession(statut);
  if (affichage.neutre) return <span className="text-ink-3">{libelle}</span>;
  return <PastilleStatut statut={affichage.statut} libelle={libelle} />;
}

/** Heure locale Europe/Brussels, format HH:MM — sert uniquement à horodater
 * l'indicateur de sauvegarde (« Enregistré 21:04 », docs/07 §4.7). Pure mise
 * en forme, aucune donnée métier. */
function heureCourante(): string {
  return new Intl.DateTimeFormat('fr-BE', {
    timeZone: FUSEAU,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}

/**
 * Écart de caisse en direct (docs/06 §3) : `0,00 ✓` en conforme quand il est
 * nul, la valeur signée en dépassement sinon. Réutilisé tel quel dans la
 * liste des sessions ET dans le panneau de clôture : un seul rendu pour une
 * seule notion.
 */
function rendreEcartCaisse(centimes: number) {
  if (centimes === 0) {
    return (
      <span className="inline-flex items-center gap-groupe font-medium text-conforme">
        <span aria-hidden="true">{GLYPHE_STATUT.conforme}</span>
        {formaterMontant(0)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-groupe font-medium text-depassement">
      <span aria-hidden="true">{GLYPHE_STATUT.depassement}</span>
      {formaterEcartMontant(centimes)}
    </span>
  );
}

/**
 * Bandeau d'écart de stock à la vente (D-037, `docs/05-DECISIONS.md`) : le
 * stock enregistré ne couvrait pas ce que des produits REVENDUS ont vendu
 * cette session. `cloturerSession` ne bloque JAMAIS pour ça — les pots ont
 * réellement été vendus, on les a vus partir — mais calcule l'écart
 * précisément pour qu'il soit VU : c'est le signal le plus direct qu'une
 * saisie de stock est fausse en amont (réception oubliée, quantité mal
 * tapée, lot jamais entré).
 *
 * `null` sur un tableau vide, DÉLIBÉRÉMENT : jamais de bandeau vert « stock
 * cohérent » à chaque clôture — un tel bandeau, identique à chaque session,
 * cesserait d'être lu, exactement le jour où il compterait (même règle que
 * `avertissementEnergie` / `avertissementCoutMatiereTransforme` ci-dessous,
 * absents plutôt qu'affichés à vide).
 *
 * N'affiche QUE ce qu'`EcartStockVente` porte réellement : l'ingrédient et la
 * quantité manquante. Jamais d'unité accolée au nombre — le contrat n'en
 * porte pas (cet écran ne charge pas la liste des ingrédients pour la
 * déduire), et en inventer une (g, ml, pièce) risquerait d'en afficher une
 * fausse. Jamais de cause non plus (réception oubliée ou erreur de saisie) :
 * les deux restent à VÉRIFIER, ce bandeau ne tranche pas entre elles.
 */
export function formaterAvertissementEcartsStock(
  ecarts: readonly EcartStockVente[],
): string | null {
  if (ecarts.length === 0) return null;

  const detail = ecarts
    .map((ecart) => `« ${ecart.nomIngredient} » (quantité manquante : ${ecart.quantiteManquante})`)
    .join(', ');
  const cible = ecarts.length === 1 ? 'cet ingrédient' : 'ces ingrédients';

  return (
    `Stock insuffisant à la vente : ${detail}. La vente reste enregistrée telle quelle — ` +
    `c'est le stock qui a tort, pas la vente : vérifiez la dernière réception ou corrigez ` +
    `l'inventaire de ${cible}.`
  );
}

/**
 * Bandeau « clôture sans aucun relevé de température » (mission AFSCA dédiée,
 * audit du 30/07/2026) : la chaîne du froid du stand est PASSIVE (glacière
 * rigide, blocs eutectiques, thermomètre sonde — CLAUDE.md §6), donc le relevé
 * est la SEULE trace qu'elle a été surveillée. `relevesTemperature` (arrivée
 * et retour) est **optionnel** à la clôture (docs/17 fiche 17,
 * `construireReleveTemperatureCloture` ci-dessus) — ce bandeau ne bloque
 * JAMAIS rien, il rappelle une fois qu'aucun des deux n'a été saisi.
 *
 * `null` sur `null` (aucune clôture soumise durant cette édition — jamais un
 * signal avant qu'un vrai résultat n'existe, même précaution que
 * `avertissementEnergieDerniereCloture` par défaut) ET dès qu'AU MOINS un
 * relevé a été saisi (arrivée OU retour) : un seul suffit à ne PAS afficher ce
 * bandeau — c'est exactement le seuil que vérifie déjà
 * `sessionsSansReleveTemperature` (`packages/db/src/services/afsca.ts`,
 * `releveTemperature.sessionId`, `.limit(1)`), et les deux doivent rester
 * d'accord sur ce qui compte comme « surveillé ».
 *
 * Ne culpabilise pas (oublier un relevé un dimanche de pluie, après six
 * heures de marché, est normal) et n'affirme RIEN sur la conformité
 * (CLAUDE.md §7 : l'application ne remplace pas l'AFSCA). Ne promet pas non
 * plus de rattrapage : un relevé ne se rattache à une session qu'À SA
 * clôture (`cloturerSession`, `packages/db/src/services/sessions.ts`,
 * `ecrireReleveTemperature`, `packages/db/src/services/afsca.ts`) — une fois
 * la session close, aucun écran de ce dépôt ne permet plus d'en rattacher un :
 * le formulaire autonome de `RegistreAfsca.tsx` (`OngletTemperatures`)
 * n'expose aucun sélecteur de session, et `POST /sessions/:id/cloturer` ne
 * s'exécute qu'une seule fois par session. Le message dit donc ce qui reste
 * VRAIMENT possible — remettre le relevé à la prochaine session — jamais un
 * bouton ou un écran qui n'existe pas.
 */
export function formaterAvertissementReleveTemperatureAbsent(
  nombreRelevesTemperatureSaisis: number | null,
): string | null {
  if (nombreRelevesTemperatureSaisis === null) return null;
  if (nombreRelevesTemperatureSaisis > 0) return null;

  return (
    "Aucun relevé de température n'a été saisi à cette clôture — la chaîne du froid du stand " +
    'est passive, le relevé est la seule preuve qu’elle a été surveillée. Rien à corriger : la ' +
    "clôture reste valable telle quelle, et l'application ne permet pas de rattacher un relevé " +
    'à une session déjà close. Pensez-y à la prochaine session, pendant que le thermomètre est ' +
    'encore sur la table.'
  );
}

/**
 * `fraisDetail` (Trou 5, docs/21-CHAMPS-NON-LUS.md §1.5, mission « détail des
 * frais d'une session » du 31/07/2026) est un LEDGER distinct des cinq
 * colonnes agrégées (`fraisEmplacementCents` et consorts) — voir le
 * commentaire de `listerFraisSession`
 * (`packages/db/src/depots/sessions.ts:113-136`) : EN L'ÉTAT, `cloturerSession`
 * (`packages/db/src/services/sessions.ts:1490-1510`) écrit EXACTEMENT une
 * ligne par catégorie non nulle, donc la somme du détail DEVRAIT toujours
 * égaler le total affiché au centime près. « Devrait » n'est pas une preuve :
 * une session close par une version antérieure du produit (avant l'existence
 * de `session_frais`, ou d'une catégorie qui n'y écrivait pas encore) peut
 * porter un total agrégé sans détail qui l'explique intégralement.
 *
 * Un détail qui ne somme pas à son total est PIRE que pas de détail du tout
 * (CLAUDE.md, mission) : on chercherait l'erreur ailleurs. Cette fonction le
 * dit donc EXPLICITEMENT plutôt que de laisser deviner, et ne modifie jamais
 * le total affiché ci-dessus : lui seul reste la valeur de référence, jamais
 * recalculé depuis le détail.
 *
 * Écart dérivé par SOUSTRACTION D'ENTIERS (centimes), jamais par un calcul de
 * part ni un arrondi : les deux membres sont déjà des entiers, aucune
 * division n'intervient nulle part dans cette fonction.
 *
 * `null` quand tout coïncide : même doctrine que les bandeaux voisins
 * (`formaterAvertissementEcartsStock` ci-dessus) — un cas normal ne s'affiche
 * jamais, seule l'anomalie remonte (docs/07 §2.6).
 */
export function formaterAvertissementFraisDetailIncomplet(
  fraisTotauxCents: number,
  fraisDetail: readonly Pick<FraisSessionLigneContrat, 'montantCents'>[],
): string | null {
  const sommeDetailCents = fraisDetail.reduce((somme, ligne) => somme + ligne.montantCents, 0);
  const ecartCents = fraisTotauxCents - sommeDetailCents;
  if (ecartCents === 0) return null;

  if (ecartCents > 0) {
    return (
      `Le détail des frais ci-dessous ne couvre que ${formaterEuros(sommeDetailCents)} sur les ` +
      `${formaterEuros(fraisTotauxCents)} de frais totaux affichés ci-dessus : ` +
      `${formaterEuros(ecartCents)} n'ont aucune ligne de détail correspondante — probablement ` +
      "un poste clôturé avant l'existence de ce détail. Le total ci-dessus reste la valeur de " +
      'référence, pas la somme du détail.'
    );
  }

  return (
    `Le détail des frais ci-dessous (${formaterEuros(sommeDetailCents)}) dépasse le total de ` +
    `frais affiché ci-dessus (${formaterEuros(fraisTotauxCents)}) de ${formaterEuros(-ecartCents)} ` +
    '— une incohérence qui ne devrait jamais se produire. Le total ci-dessus reste la valeur de ' +
    'référence, pas la somme du détail.'
  );
}

/**
 * Libellé humain d'une ligne de `fraisDetail`. Aujourd'hui, `ligne.libelle`
 * EST la catégorie brute (`cloturerSession` écrit `libelle: categorie`,
 * `packages/db/src/services/sessions.ts:1504`) : cette table ne fait que
 * traduire les cinq valeurs connues aujourd'hui pour l'affichage. Elle rend
 * le libellé BRUT tel quel dès qu'il ne correspond à aucune entrée connue —
 * le jour où une ligne porte un vrai texte libre (plusieurs « divers »
 * distincts, promesse documentée dans
 * `packages/db/src/depots/sessions.ts:126-130`), ce texte s'affiche sans
 * traduction plutôt que d'être écrasé par un libellé générique « Divers ».
 * Jamais de catégorie inventée ici : seulement une mise en forme des cinq
 * valeurs déjà écrites par `cloturerSession`.
 */
const LIBELLE_CATEGORIE_FRAIS: Readonly<Record<string, string>> = {
  emplacement: 'Emplacement',
  deplacement: 'Déplacement',
  gaz: 'Gaz',
  divers: 'Divers',
  energie: 'Énergie',
};

export function libelleFraisAffiche(ligne: Pick<FraisSessionLigneContrat, 'libelle'>): string {
  return LIBELLE_CATEGORIE_FRAIS[ligne.libelle] ?? ligne.libelle;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Saisie — parsing pur (jamais un calcul métier, seulement lire une chaîne),
   même principe que `parserEntierPositif` dans Production.tsx et
   `parserEuros` dans packages/core/src/argent.ts.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Une quantité vendue vide veut dire « rien vendu de ce produit » : 0 est
 * une valeur légitime et attendue à chaque frappe, pas une absence — à la
 * différence de l'affichage (`ouTiret`), qui reste réservé aux valeurs jamais
 * saisies. */
function parserEntierNonNegatifOuVide(saisie: string): number | null {
  const nettoyee = saisie.trim();
  if (nettoyee === '') return 0;
  if (!/^\d+$/.test(nettoyee)) return null;
  return Number.parseInt(nettoyee, 10);
}

/** Même logique pour les frais annexes : un poste non renseigné vaut 0, pas
 * une saisie bloquante (à la différence des espèces comptées et du montant
 * carte, qui restent des montants obligatoires — voir `cloturerSession`). */
function parserEurosOuZero(saisie: string): number | null {
  return saisie.trim() === '' ? 0 : parserEuros(saisie);
}

/**
 * Kilomètres RÉELS d'une session (D-064) : une TOURNÉE, pas un aller-retour
 * automatique — « tu dois laisser libre ce champ afin que je puisse par
 * exemple aller du marché à un autre marché ou chez des fournisseurs » (le
 * porteur, séance du 30/07/2026). Champ entièrement LIBRE, jamais un
 * interrupteur.
 *
 * Virgule ET point acceptés (« 23,4 » comme « 23.4 ») — même convention que
 * `parserTemperatureOptionnelle` ci-dessous : ce champ se remplit à 23 h après
 * un marché de six heures et demie, la virgule décimale belge n'est pas un
 * détail.
 *
 * `null` = champ VIDE (kilométrage non renseigné, JAMAIS 0 — CLAUDE.md §7 :
 * une valeur inconnue vaut `null`, jamais 0, qui laisserait croire à un
 * déplacement gratuit en carburant et en usure). `undefined` = saisie
 * présente mais illisible comme un nombre positif.
 */
export function parserDistanceReelleOptionnelle(saisie: string): number | null | undefined {
  const nettoyee = saisie.trim().replace(',', '.');
  if (nettoyee === '') return null;
  if (!/^\d+(\.\d+)?$/.test(nettoyee)) return undefined;
  const valeur = Number(nettoyee);
  return Number.isFinite(valeur) ? valeur : undefined;
}

/**
 * Attribution obligatoire (licence CC-BY 4.0) : le champ « Kilomètres réels »
 * ci-dessus est PRÉ-REMPLI depuis `distancesReferenceParLieu`
 * (`lieu_marche.distance_km`), qui peut avoir été calculée automatiquement par
 * OpenRouteService à partir de données OpenStreetMap
 * (`apps/api/src/itineraire/client.ts`, `ATTRIBUTION_OPENSTREETMAP`) — même
 * mention que `LieuxMarche.tsx`, `ComparaisonLieux.tsx` et `Opportunites.tsx`,
 * reprise ici plutôt qu'inventée une quatrième fois.
 */
const MENTION_ATTRIBUTION_DISTANCE =
  'Distance calculée automatiquement via OpenRouteService, © contributeurs OpenStreetMap (CC BY 4.0), ou saisie manuellement.';

/* ═══════════════════════════════════════════════════════════════════════════
   Justificatif (ticket) d'un frais de session

   `session_frais.justificatif_path` existait en base, migrée, jamais
   renseignée (audit du 30/07/2026) : un frais sans pièce est un frais qu'on
   AFFIRME, pas qu'on prouve. Même mécanisme que la pièce jointe d'une facture
   fournisseur ou d'une réception (`validerPieceJointe`,
   `packages/db/src/services/factures.ts`) — mêmes types MIME acceptés, même
   plafond de taille, même lecture en Data URI via `FileReader` que
   `Factures.tsx` (aucun module partagé n'existe pour ce geste aujourd'hui :
   `Factures.tsx` porte sa propre copie locale de ces constantes, hors
   périmètre d'écriture de cette mission — voir le rapport de livraison).
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Les quatre postes de frais SAISIS à la clôture — `energie` n'en fait pas
 * partie : ce poste est CALCULÉ (durées d'équipement × prix du kWh), jamais
 * une dépense avec un ticket à joindre (voir `FraisSaisis`,
 * `packages/db/src/services/sessions.ts`).
 */
type CategorieFraisAvecJustificatif = 'emplacement' | 'deplacement' | 'gaz' | 'divers';

/** Types MIME acceptés, mêmes règles que `validerPieceJointe` côté serveur. */
const TYPES_MIME_PIECE_JOINTE_ACCEPTES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

/** Même plafond que côté serveur (`packages/db/src/services/factures.ts`) :
 *  feedback immédiat, la vérification qui compte reste celle du serveur. */
const TAILLE_MAX_PIECE_JOINTE_OCTETS = 8 * 1024 * 1024;

const JUSTIFICATIFS_FRAIS_VIDES: Readonly<Record<CategorieFraisAvecJustificatif, string | null>> = {
  emplacement: null,
  deplacement: null,
  gaz: null,
  divers: null,
};

const ERREURS_JUSTIFICATIFS_FRAIS_VIDES: Readonly<
  Record<CategorieFraisAvecJustificatif, string | null>
> = { emplacement: null, deplacement: null, gaz: null, divers: null };

/**
 * Durée d'utilisation d'un équipement électrique pendant la session, en
 * minutes (fiche 17). `null` = champ VIDE (appareil non utilisé cette
 * session-ci, JAMAIS 0 minute saisie de force) ; `undefined` = saisie
 * présente mais illisible comme un entier strictement positif — même
 * convention que `parserDistanceReelleOptionnelle` ci-dessus.
 */
export function parserDureeEquipementOptionnelle(saisie: string): number | null | undefined {
  const nettoyee = saisie.trim();
  if (nettoyee === '') return null;
  if (!/^\d+$/.test(nettoyee)) return undefined;
  const valeur = Number.parseInt(nettoyee, 10);
  return valeur > 0 ? valeur : undefined;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Températures à la clôture (docs/17 fiche 17)

   « Un registre qu'on remplit ailleurs est un registre qu'on ne remplit pas »
   (docs/06 §3) : les relevés d'arrivée et de retour se saisissent ICI, plutôt
   que de renvoyer vers l'écran Registre AFSCA. **Optionnel** dans les deux
   cas : un relevé qui manque reste manquant, jamais reconstitué (CLAUDE.md
   §7) — laisser la température vide ne bloque rien.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Les deux seuls moments que couvre CET écran ; `depart`, `mi_session` et
 *  `stockage` restent la responsabilité de l'écran Registre AFSCA. */
type MomentTemperatureCloture = 'arrivee' | 'retour';

const LIBELLE_MOMENT_TEMPERATURE: Readonly<Record<MomentTemperatureCloture, string>> = {
  arrivee: 'à l’arrivée',
  retour: 'au retour',
};

type SaisieReleveTemperature = {
  readonly equipement: string;
  readonly temperature: string;
  readonly actionCorrective: string;
};

// Seul « Glacière rigide » est utilisé nulle part ailleurs dans ce dépôt
// (chaîne du froid passive, CLAUDE.md §6) : un intitulé pré-rempli fait gagner
// une saisie, mais reste un simple LIBELLÉ, jamais une valeur mesurée — la
// règle « un champ température ne se pré-remplit jamais » ne porte que sur la
// température elle-même (voir RegistreAfsca.tsx).
const RELEVE_TEMPERATURE_VIDE: SaisieReleveTemperature = {
  equipement: 'Glacière rigide',
  temperature: '',
  actionCorrective: '',
};

/**
 * `null` = rien saisi (le relevé reste absent, ce n'est jamais une erreur) ;
 * `undefined` = une valeur a été tapée mais ne se lit pas comme un nombre.
 * Même convention que `parserTemperature` de `RegistreAfsca.tsx`.
 */
function parserTemperatureOptionnelle(saisie: string): number | null | undefined {
  const nettoyee = saisie.trim().replace(',', '.');
  if (nettoyee === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(nettoyee)) return undefined;
  const valeur = Number(nettoyee);
  return Number.isFinite(valeur) ? valeur : undefined;
}

type ReleveTemperatureClotureConstruit = NonNullable<ClotureSession['relevesTemperature']>[number];

/**
 * Construit l'élément du contrat à partir de la saisie, ou refuse avec un
 * message nommé — jamais un calcul métier : juste la mise en forme d'une
 * saisie et la traduction de l'absence en « rien à envoyer ».
 */
function construireReleveTemperatureCloture(
  moment: MomentTemperatureCloture,
  saisie: SaisieReleveTemperature,
):
  | { statut: 'absent' }
  | { statut: 'erreur'; message: string }
  | { statut: 'ok'; releve: ReleveTemperatureClotureConstruit } {
  const temperature = parserTemperatureOptionnelle(saisie.temperature);
  if (temperature === null) return { statut: 'absent' };
  if (temperature === undefined) {
    return {
      statut: 'erreur',
      message:
        `Le relevé de température ${LIBELLE_MOMENT_TEMPERATURE[moment]} doit être un nombre ` +
        '(ex. 4 ou -2,5), ou laissé vide si non pris.',
    };
  }
  const equipement = saisie.equipement.trim();
  if (equipement === '') {
    return {
      statut: 'erreur',
      message: `Indiquez l'équipement mesuré pour le relevé de température ${LIBELLE_MOMENT_TEMPERATURE[moment]}.`,
    };
  }
  return {
    statut: 'ok',
    releve: {
      moment,
      equipement,
      temperatureC: temperature,
      actionCorrective:
        saisie.actionCorrective.trim() === '' ? null : saisie.actionCorrective.trim(),
    },
  };
}

/**
 * `GET /api/lieux` et `GET /api/produits-vendables` n'ont pas d'enveloppe
 * `{ data, meta }` exportée par `packages/core/src/contrats/sessions.ts` — à
 * la différence de `schemaListeSessions`, `schemaListeRecettes`, etc. C'est
 * un MANQUE DU CONTRAT (voir le rapport de livraison). En attendant qu'il
 * soit comblé, chaque ÉLÉMENT de la liste reste validé par le schéma du
 * contrat (`schemaLieuMarche.parse` / `schemaProduitVendable.parse`) ; seule
 * l'enveloppe est vérifiée ici à la main, sans ajouter `zod` comme dépendance
 * directe de `apps/web` (les schémas déjà exportés par `@batte/core`
 * suffisent, exactement comme le fait déjà `apps/web/src/lib/api.ts` pour
 * l'enveloppe d'erreur).
 */
function estEnveloppeAvecData(valeur: unknown): valeur is { data: unknown[] } {
  if (typeof valeur !== 'object' || valeur === null) return false;
  const objet = valeur as { data?: unknown };
  return Array.isArray(objet.data);
}

function analyserEnveloppe<T>(
  valeur: unknown,
  schema: { parse: (v: unknown) => T },
  nomRoute: string,
): T[] {
  if (!estEnveloppeAvecData(valeur)) {
    throw new Error(`Réponse inattendue du serveur pour ${nomRoute}.`);
  }
  return valeur.data.map((item) => schema.parse(item));
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ventes — construction des lignes et aide à la frappe
   ═══════════════════════════════════════════════════════════════════════════ */

type LigneLibre = {
  clientId: string;
  produitId: string;
  quantiteSaisie: string;
  prixUnitaireSaisie: string;
};

type LigneVenteConstruite = {
  produitVenteId: string;
  quantite: number;
  prixUnitaireCents: number;
};

/**
 * Construit les lignes de vente à envoyer au serveur à partir de la saisie
 * en cours : une ligne par produit du catalogue dont la quantité est > 0,
 * plus les lignes libres valides. Rend une ERREUR (jamais un `0` deviné) dès
 * qu'un champ non vide ne parse pas — la même discipline que
 * `parserEuros`/`parserEntierPositif` ailleurs dans l'application.
 *
 * Réutilisée pour DEUX usages : l'aide à la frappe (tolérante : une erreur
 * donne simplement un tableau vide, sans bloquer l'affichage) et la
 * validation de clôture (stricte : l'erreur est montrée et bloque l'envoi).
 */
function construireLignesVente(
  produitsVendables: readonly ProduitVendable[],
  quantitesCatalogue: Readonly<Record<string, string>>,
  lignesLibres: readonly LigneLibre[],
): { lignes: LigneVenteConstruite[]; erreur: string | null } {
  const lignes: LigneVenteConstruite[] = [];

  for (const produit of produitsVendables) {
    const saisie = quantitesCatalogue[produit.id] ?? '';
    const quantite = parserEntierNonNegatifOuVide(saisie);
    if (quantite === null) {
      return {
        lignes: [],
        erreur: `La quantité de « ${produit.nom} » doit être un nombre entier de crêpes ou d'unités.`,
      };
    }
    if (quantite > 0) {
      lignes.push({ produitVenteId: produit.id, quantite, prixUnitaireCents: produit.prixCents });
    }
  }

  for (const ligneLibre of lignesLibres) {
    const produit = produitsVendables.find((p) => p.id === ligneLibre.produitId);
    if (produit === undefined) continue;
    const quantite = parserEntierNonNegatifOuVide(ligneLibre.quantiteSaisie);
    if (quantite === null) {
      return {
        lignes: [],
        erreur: `La quantité saisie sur une ligne libre (« ${produit.nom} ») doit être un nombre entier.`,
      };
    }
    const prixUnitaireCents = parserEuros(ligneLibre.prixUnitaireSaisie);
    if (prixUnitaireCents === null) {
      return {
        lignes: [],
        erreur: `Le prix unitaire saisi sur une ligne libre (« ${produit.nom} ») n'est pas un montant valide.`,
      };
    }
    if (quantite > 0) {
      lignes.push({ produitVenteId: produit.id, quantite, prixUnitaireCents });
    }
  }

  if (lignes.length === 0) {
    return { lignes: [], erreur: 'Saisissez au moins une vente avant de clôturer.' };
  }

  return { lignes, erreur: null };
}

/**
 * Ramène la nature D'UN PRODUIT VENDABLE (trois valeurs, menu compris —
 * `ProduitVendable.nature`) à celle qu'accepte `LigneVente` de `@batte/core`
 * (deux valeurs, JAMAIS `'menu'` — voir la doc de `NatureProduit`,
 * `packages/core/src/sessions.ts`) : un menu non explosé qui l'atteindrait
 * tomberait ENTIÈREMENT dans `caRevenduCents`, exactement l'erreur que ce
 * type protège côté serveur (Trou 1, audit du 30/07/2026).
 *
 * `'revendu'` est un choix ARBITRAIRE et SANS CONSÉQUENCE pour un menu ICI :
 * cet aperçu est de la pure AIDE À LA FRAPPE (jamais persisté, jamais
 * autoritaire — voir l'en-tête du composant), et `caTransformeCents` /
 * `caRevenduCents` qu'il calcule ne sont JAMAIS affichés (l'écran ne montre
 * que `detail.caTransformeCents` / `detail.caRevenduCents`, renvoyés par le
 * serveur APRÈS le véritable éclatement — `exploserLigneMenu`,
 * `packages/db/src/services/sessions.ts`). Seuls `caTotalCents` (exact : une
 * simple quantité × prix, indépendante de la nature) et `crepesVendues`
 * (`nbCrepesParUnite` vaut déjà `0` pour un menu, `nbCrepes` étant forcé
 * `null` par `verifierCoherenceProduit`) survivent jusqu'à l'écran — la vraie
 * ventilation transforme/revendu d'un menu exigerait de charger sa
 * composition ICI, ce que cet écran ne fait pas.
 */
function natureLigneVentePourApercu(produit: ProduitVendable): LigneVente['nature'] {
  return produit.nature === 'transforme' ? 'transforme' : 'revendu';
}

/** Suffixe affiché après le nom d'un produit vendable, pour distinguer les
 * TROIS natures (transformé, revendu, menu — fiche 16 §2) à l'oeil, sans
 * dépendre d'une couleur : voir le commentaire sur `data-troncature="repli"`
 * plus bas, qui explique pourquoi ce suffixe ne doit jamais être tronqué. */
function suffixeNatureProduit(produit: ProduitVendable): string {
  if (produit.nature === 'revendu') return ' (revente)';
  if (produit.nature === 'menu') return ' (menu)';
  return '';
}

/** Convertit les lignes construites (forme du contrat) vers le type de
 * `@batte/core` attendu par `totaliserVentes` — la SEULE information ajoutée
 * ici (nature, crêpes par unité, consommation sur place) vient du produit du
 * référentiel déjà chargé, jamais d'une hypothèse. */
function versLigneVenteCore(
  lignes: readonly LigneVenteConstruite[],
  produitsParId: ReadonlyMap<string, ProduitVendable>,
): LigneVente[] {
  const resultat: LigneVente[] = [];
  for (const ligne of lignes) {
    const produit = produitsParId.get(ligne.produitVenteId);
    if (produit === undefined) continue;
    resultat.push({
      produitVenteId: ligne.produitVenteId,
      nature: natureLigneVentePourApercu(produit),
      quantite: ligne.quantite,
      prixUnitaireCents: ligne.prixUnitaireCents,
      nbCrepesParUnite: produit.nbCrepes ?? 0,
      consommationSurPlace: produit.consommationSurPlace,
    });
  }
  return resultat;
}

/** Total d'UNE ligne, par réutilisation de `totaliserVentes` sur un tableau
 * à un seul élément : zéro formule réécrite, même sur une simple
 * multiplication (règle n°1, CLAUDE.md §3). */
function totalLigne(produit: ProduitVendable, quantite: number, prixUnitaireCents: number): number {
  return totaliserVentes([
    {
      produitVenteId: produit.id,
      nature: natureLigneVentePourApercu(produit),
      quantite,
      prixUnitaireCents,
      nbCrepesParUnite: produit.nbCrepes ?? 0,
      consommationSurPlace: produit.consommationSurPlace,
    },
  ]).caTotalCents;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Détail en lecture seule (session clôturée ou annulée) — réutilisé à deux
   endroits : le panneau docked de la liste, et la confirmation affichée dans
   le panneau de clôture juste après un enregistrement réussi.
   ═══════════════════════════════════════════════════════════════════════════ */

type VenteDetailAffichee = SessionDetail['ventes'][number] & { cleSynthetique: string };

const COLONNES_VENTES_DETAIL: ReadonlyArray<ColonneTableau<VenteDetailAffichee>> = [
  {
    cle: 'produit',
    libelle: 'Produit',
    largeur: '36%',
    alignement: 'texte',
    rendu: (v) => v.nomProduit,
    titre: (v) => v.nomProduit,
  },
  {
    cle: 'quantite',
    libelle: 'Qté',
    largeur: '14%',
    alignement: 'nombre',
    rendu: (v) => new Intl.NumberFormat('fr-BE').format(v.quantite),
  },
  {
    cle: 'pu',
    libelle: 'PU (€)',
    largeur: '16%',
    alignement: 'nombre',
    rendu: (v) => formaterMontant(v.prixUnitaireCents),
  },
  {
    cle: 'montant',
    libelle: 'Total (€)',
    largeur: '18%',
    alignement: 'nombre',
    rendu: (v) => formaterMontant(v.montantCents),
  },
  {
    cle: 'creneau',
    libelle: 'Créneau',
    largeur: '16%',
    alignement: 'texte',
    // Ce tableau est rendu à DEUX endroits : en pleine largeur dans le panneau
    // de clôture, et dans la fiche dockée large de 460 px. Dans le second cas,
    // 16 % laissent ~50 px utiles — assez pour « 10:00 » et rien de plus. Or un
    // créneau se distingue par sa FIN : « 10:00–11:00 » et « 10:00–12:00 »
    // s'affichent alors tous deux « 10:00–… ». Deux créneaux distincts
    // deviennent la même chaîne, et le mix horaire est justement l'axe
    // d'analyse que cette colonne existe pour porter.
    troncature: 'repli',
    rendu: (v) => ouTiret(v.creneauHoraire, (c) => c),
  },
];

/**
 * Détail des frais d'UNE session (Trou 5, docs/21 §1.5) — `fraisDetail` du
 * contrat (`packages/core/src/contrats/sessions.ts:344-350,474`). Pas de
 * colonne « Catégorie » séparée : en l'état, `libelle` EST la catégorie
 * (`cloturerSession` écrit `libelle: categorie`,
 * `packages/db/src/services/sessions.ts:1504`) — une seconde colonne
 * répéterait la même valeur pour un coût de rangée que docs/07 §4.4 fait
 * payer cher (~16 rangées visibles à 1280×720).
 */
const COLONNES_FRAIS_DETAIL: ReadonlyArray<ColonneTableau<FraisSessionLigneContrat>> = [
  {
    cle: 'libelle',
    libelle: 'Poste',
    largeur: '40%',
    alignement: 'texte',
    rendu: (l) => libelleFraisAffiche(l),
  },
  {
    cle: 'montant',
    libelle: 'Montant (€)',
    largeur: '28%',
    alignement: 'nombre',
    rendu: (l) => formaterMontant(l.montantCents),
  },
  {
    cle: 'justificatif',
    libelle: 'Justificatif',
    largeur: '32%',
    alignement: 'texte',
    rendu: (l) =>
      l.justificatifPath !== null ? (
        <LienJustificatifFrais
          justificatif={l.justificatifPath}
          identifiant={`${l.categorie}-${l.id}`}
        />
      ) : (
        TIRET_ABSENT
      ),
  },
];

function LigneMetrique({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <p className="flex items-baseline justify-between border-b border-line px-4 py-2 text-sm">
      <span className="text-ink-2">{libelle}</span>
      <span className="num text-ink">{valeur}</span>
    </p>
  );
}

/**
 * Un relevé de température (docs/17 fiche 17), pour un des deux moments que
 * couvre l'écran de clôture. Factorisé pour ne pas dupliquer deux fois les
 * mêmes trois champs (arrivée / retour) — même style que les autres champs de
 * la clôture (CAISSE, PRODUCTION, FRAIS).
 */
function BlocReleveTemperature({
  moment,
  idPrefixe,
  saisie,
  onChange,
}: {
  moment: MomentTemperatureCloture;
  idPrefixe: string;
  saisie: SaisieReleveTemperature;
  onChange: (valeur: SaisieReleveTemperature) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-bloc">
      <label
        className="flex flex-col gap-groupe text-sm text-ink-2"
        htmlFor={`${idPrefixe}-equipement`}
      >
        Équipement {LIBELLE_MOMENT_TEMPERATURE[moment]}
        <input
          id={`${idPrefixe}-equipement`}
          type="text"
          className="h-controle w-40 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
          value={saisie.equipement}
          onChange={(e) => onChange({ ...saisie, equipement: e.target.value })}
        />
      </label>
      <label
        className="flex flex-col gap-groupe text-sm text-ink-2"
        htmlFor={`${idPrefixe}-temperature`}
      >
        Température °C {LIBELLE_MOMENT_TEMPERATURE[moment]} (optionnel)
        {/* JAMAIS de valeur par défaut : un champ pré-rempli se validerait
            sans être lu (même règle que RegistreAfsca.tsx). */}
        <input
          id={`${idPrefixe}-temperature`}
          type="text"
          inputMode="decimal"
          placeholder="—"
          className="num h-controle w-24 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
          value={saisie.temperature}
          onChange={(e) => onChange({ ...saisie, temperature: e.target.value })}
        />
      </label>
      <label
        className="flex flex-col gap-groupe text-sm text-ink-2"
        htmlFor={`${idPrefixe}-action`}
      >
        Action corrective (si hors seuil)
        <input
          id={`${idPrefixe}-action`}
          type="text"
          className="h-controle w-64 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
          value={saisie.actionCorrective}
          onChange={(e) => onChange({ ...saisie, actionCorrective: e.target.value })}
        />
      </label>
    </div>
  );
}

/**
 * Champ « ticket » d'UN frais de session (mission « justificatif d'un frais
 * de session », 30/07/2026) — `<input type="file">` contrôlé par le parent ;
 * la conversion en Data URI se fait dans `surChangementJustificatifFrais`
 * (composant `Sessions`, plus bas). Un fichier rejeté n'empêche jamais la
 * clôture : l'erreur reste informative, jamais bloquante.
 */
function ChampJustificatifFrais({
  id,
  libelle,
  valeur,
  erreur,
  onChange,
}: {
  id: string;
  libelle: string;
  valeur: string | null;
  erreur: string | null;
  onChange: (evenement: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="flex flex-col gap-groupe text-xs text-ink-2" htmlFor={id}>
      {libelle}
      <input
        id={id}
        name={id}
        type="file"
        accept={TYPES_MIME_PIECE_JOINTE_ACCEPTES.join(',')}
        onChange={onChange}
        // `w-40` (160 px) coupait les libellés natifs du navigateur en
        // « Choisir un fichier Aucu…hoisi » (mesuré en DOM le 31/07/2026) :
        // l'ellipse vient de Chrome lui-même, pas de nous, et `Factures.tsx`
        // le contourne déjà — non pas en construisant un habillage
        // personnalisé, mais simplement en NE contraignant PAS la largeur du
        // champ natif (`block w-full`) et en s'appuyant sur la ligne
        // « Prêt à être joint » ci-dessous, pas sur le texte natif, pour
        // confirmer la sélection. Ici le champ vit dans une rangée
        // `flex-wrap` de largeurs fixes (jamais `w-full`, qui prendrait toute
        // la largeur restante) : `w-60` (240 px) est la largeur Tailwind la
        // plus proche au-dessus du besoin RÉEL du contrôle natif, mesuré à
        // 225,6 px sans contrainte sur ce poste.
        className="block w-60 text-xs text-ink-2"
      />
      {valeur !== null && <span className="text-2xs text-conforme">Prêt à être joint.</span>}
      {erreur !== null && <span className="text-2xs text-depassement">{erreur}</span>}
    </label>
  );
}

/**
 * Lien de téléchargement d'UN justificatif de frais, dans le détail lu à la
 * clôture (mission « détail des frais d'une session », 31/07/2026) — MÊME
 * garde que `LienPieceJointe` (`Factures.tsx`) contre l'exécution d'une Data
 * URI dans le navigateur (mission « surface d'attaque », 30/07/2026) :
 * `download` FORCE l'enregistrement sur disque au lieu d'une navigation vers
 * la Data URI — sans lui, un `data:application/pdf` porteur de script
 * s'exécuterait dans le lecteur intégré du navigateur plutôt que d'être
 * simplement téléchargé. Aucun `target` : une Data URI n'a pas de
 * `window.opener` à protéger.
 *
 * Copie locale plutôt qu'import cross-écran : `Factures.tsx` est hors
 * périmètre d'écriture de cette mission, et porte déjà sa propre copie des
 * mêmes règles (`TYPES_MIME_PIECE_JOINTE_ACCEPTES` ci-dessus, même
 * précédent). Composant NOMMÉ et exporté pour être testé isolément par
 * `renderToStaticMarkup` — ni `jsdom` ni `@testing-library/react` ne sont
 * installés (CLAUDE.md §7, `vitest.config.ts`).
 */
export function LienJustificatifFrais({
  justificatif,
  identifiant,
}: {
  readonly justificatif: string;
  readonly identifiant: string;
}) {
  return (
    <a
      href={justificatif}
      download={`justificatif-frais-${identifiant}`}
      className={CLASSE_BOUTON_LIEN}
    >
      Voir le justificatif
    </a>
  );
}

/** `46,8 km` — jusqu'à une décimale, assez pour relire un chiffre lu sur un
 *  compteur ou une carte sans faire disparaître le dixième saisi (Trou 1). */
function formaterKm(km: number): string {
  return `${formaterKmPourSaisie(km)} km`;
}

/**
 * Même précision et même virgule française que `formaterKm`, mais SANS
 * l'unité et SANS séparateur de milliers : pour pré-remplir un CHAMP DE
 * SAISIE éditable (dont la valeur doit rester une chaîne que
 * `parserDistanceReelleOptionnelle` relira), jamais pour un simple affichage.
 *
 * Existe séparément depuis D-074 : la distance de référence d'un lieu
 * (`lieu_marche.distance_km`) peut désormais porter une décimale (calculée
 * par OpenRouteService au dixième de km près, `apps/api/src/itineraire/
 * client.ts`) là où elle était toujours un compte rond auparavant. Un
 * `String(nombre)` brut afficherait alors un point anglo-saxon (« 24.8 »)
 * dans un champ où tout le reste du formulaire parle en virgules — `useGrouping:
 * false` évite en plus qu'un éventuel séparateur de milliers (peu probable à
 * cette échelle, mais jamais à exclure) ne rende la valeur illisible par le
 * parseur.
 */
export function formaterKmPourSaisie(km: number): string {
  return new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 1, useGrouping: false }).format(
    km,
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Météo figée à la clôture (audit du 30/07/2026, mission « météo prévue et
   réelle d'une session ») — `detail.meteoPrevue` / `detail.meteoReelle`, une
   PHOTOGRAPHIE d'un relevé `meteo_observation` prise à la clôture
   (`services/sessions.ts::cloturerSession`), jamais recalculée ici. Pure mise
   en forme, aucun calcul métier (règle n°1, CLAUDE.md §3).
   ═══════════════════════════════════════════════════════════════════════════ */

/** Une décimale, sans unité — même mise en forme que `RegistreAfsca.tsx`
 *  pour un relevé météo, redéclarée ici (fonction non exportée là-bas). */
function formaterDecimaleMeteo(valeur: number): string {
  return new Intl.NumberFormat('fr-BE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(valeur);
}

/** `12,4 °C · pluie 40 % · vent 18 km/h` — ne montre que ce qui est connu :
 *  un relevé ancien peut ne porter qu'une partie des huit champs. */
function formaterReleveMeteoSession(releve: MeteoSessionReleve): string {
  const morceaux: string[] = [];
  if (releve.temperatureC !== null) {
    morceaux.push(`${formaterDecimaleMeteo(releve.temperatureC)} °C`);
  }
  if (releve.probabilitePluieBp !== null) {
    morceaux.push(`pluie ${formaterPourcent(releve.probabilitePluieBp)}`);
  } else if (releve.precipitationsMm !== null) {
    morceaux.push(`${formaterDecimaleMeteo(releve.precipitationsMm)} mm`);
  }
  if (releve.ventKmh !== null) {
    morceaux.push(`vent ${formaterDecimaleMeteo(releve.ventKmh)} km/h`);
  }
  return morceaux.length === 0 ? TIRET_ABSENT : morceaux.join(' · ');
}

/**
 * Même relevé que ci-dessus, avec l'horizon retenu affiché explicitement —
 * JAMAIS `J-0` : `cloturerSession` n'écrit `meteoPrevue` qu'avec un horizon
 * `>= 1` (jamais « la dernière connue » du matin même), la mention rend cette
 * garantie visible plutôt que de la laisser implicite.
 */
function formaterMeteoPrevueSession(releve: MeteoSessionReleve): string {
  const base = formaterReleveMeteoSession(releve);
  if (base === TIRET_ABSENT || releve.horizonJours === null) return base;
  return `${base} (prévision à J-${releve.horizonJours})`;
}

function BlocDetailSession({ detail }: { detail: SessionDetail }) {
  const fraisTotauxCents =
    detail.fraisEmplacementCents +
    detail.fraisDeplacementCents +
    detail.fraisGazCents +
    detail.fraisDiversCents +
    detail.fraisEnergieCents;
  const ventesAffichees: VenteDetailAffichee[] = detail.ventes.map((v, i) => ({
    ...v,
    cleSynthetique: `${v.produitVenteId}-${i}`,
  }));
  /**
   * Détail des frais (Trou 5) : REPLIÉ par défaut — on ne le consulte qu'en
   * cas de doute (justificatif à retrouver), jamais à chaque clôture, et ce
   * bloc porte déjà ~25 rangées avant lui (docs/07 §4.4, ~16 rangées visibles
   * à 1280×720 : le déplier par défaut coûterait des rangées à CHAQUE
   * consultation). Le bouton, lui, reste TOUJOURS visible et clairement
   * étiqueté (compte inclus) : un détail trop caché ne se retrouve jamais.
   * État LOCAL à ce composant : un rechargement en place de `detail` (D-079 —
   * `rattacherEvenement`, `annulerSession` écrivent directement `'pret'`,
   * jamais en repassant par `'chargement'`) ne démonte pas ce composant et ne
   * réinitialise donc pas ce repli, pas plus qu'il ne détruit le focus posé
   * sur le bouton ci-dessous.
   */
  const [detailFraisOuvert, setDetailFraisOuvert] = useState(false);
  /** Calculé une seule fois par rendu, même raison que `avertissementEcartsStock`. */
  const avertissementFraisDetailIncomplet = formaterAvertissementFraisDetailIncomplet(
    fraisTotauxCents,
    detail.fraisDetail,
  );
  // Rien à déplier quand il n'y a ni ligne de détail ni frais total à
  // expliquer : un bouton toujours présent mais toujours vide serait du bruit
  // (docs/07 §2.6 — un compteur à zéro reste silencieux).
  const detailFraisPertinent = detail.fraisDetail.length > 0 || fraisTotauxCents !== 0;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-groupe border-b border-line px-4 py-2">
        <p className="text-sm font-medium text-ink">
          {detail.numero} — {formaterDate(detail.dateSession)} — {detail.lieuNom}
        </p>
        <PastilleStatutSession statut={detail.statut} />
      </div>

      {/* Date de clôture RÉELLE (audit du 30/07/2026) : distincte de
          `statut === 'cloturee'` ci-dessus, qui dit seulement QUE la session
          l'est, jamais QUAND. `null` = pas encore clôturée : rien à afficher
          plutôt qu'une ligne vide. */}
      {detail.dateCloture !== null && (
        <p className="border-b border-line px-4 py-1 text-xs text-ink-3">
          Clôturée le {formaterDateHeure(detail.dateCloture)}
        </p>
      )}
      {/* Météo FIGÉE à la clôture (audit du 30/07/2026, mission « météo prévue
          et réelle d'une session ») : `meteoPrevue` porte la révision la plus
          proche de J-1 disponible — jamais la dernière connue du matin même
          (voir `cloturerSession`) — `meteoReelle` le relevé du jour même.
          `null` = aucun relevé exploitable pour ce lieu et cette date au
          moment de la clôture, jamais reconstitué après coup. */}
      <LigneMetrique
        libelle="Météo prévue (décision de production)"
        valeur={ouTiret(detail.meteoPrevue, formaterMeteoPrevueSession)}
      />
      <LigneMetrique
        libelle="Météo réelle"
        valeur={ouTiret(detail.meteoReelle, formaterReleveMeteoSession)}
      />

      <LigneMetrique libelle="CA total" valeur={ouTiret(detail.caTotalCents, formaterEuros)} />
      <LigneMetrique
        libelle="dont transformé"
        valeur={ouTiret(detail.caTransformeCents, formaterEuros)}
      />
      <LigneMetrique
        libelle="dont revendu"
        valeur={ouTiret(detail.caRevenduCents, formaterEuros)}
      />
      <LigneMetrique
        libelle="dont consommé sur place (SCE)"
        valeur={ouTiret(detail.caSurPlaceCents, formaterEuros)}
      />
      <LigneMetrique
        libelle="Coût matière réel"
        valeur={ouTiret(detail.coutMatiereCents, formaterEuros)}
      />
      <LigneMetrique
        libelle="Commission carte"
        valeur={ouTiret(detail.commissionCarteCents, formaterEuros)}
      />
      {/* Fiche 17, cas 3 seulement (facturation au compteur) : `0` couvre à la
          fois un ZÉRO CERTAIN (aucune électricité sur ce lieu, ou déjà comptée
          dans l'emplacement/le forfait — double comptage évité) et un zéro par
          EXCLUSION (aucune durée d'équipement enregistrée pour cette
          session) — le bandeau affiché juste après la clôture est le seul
          endroit qui distingue les deux, jamais reconstitué ici. */}
      <LigneMetrique libelle="Frais électricité" valeur={formaterEuros(detail.fraisEnergieCents)} />
      <LigneMetrique libelle="Frais totaux" valeur={formaterEuros(fraisTotauxCents)} />
      {/* Détail des frais, catégorie par catégorie (Trou 5, docs/21 §1.5) :
          `fraisDetail` était calculé et transmis depuis le 30/07/2026 sans
          qu'aucun écran ne le lise (Zod le tronquait silencieusement avant
          cette date). Le bandeau d'incohérence reste TOUJOURS visible (une
          anomalie remonte, docs/07 §2.6) ; seule la liste ligne à ligne est
          repliée par défaut (voir le commentaire au-dessus de
          `detailFraisOuvert`). */}
      {detailFraisPertinent && (
        <>
          {avertissementFraisDetailIncomplet !== null && (
            <p className="border-b border-line px-4 py-2 text-sm text-ink-2">
              <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span>{' '}
              {avertissementFraisDetailIncomplet}
            </p>
          )}
          <div className="border-b border-line px-4 py-2">
            <button
              type="button"
              onClick={() => setDetailFraisOuvert((ouvert) => !ouvert)}
              aria-expanded={detailFraisOuvert}
              className={CLASSE_BOUTON_LIEN}
            >
              {detailFraisOuvert
                ? 'Masquer le détail des frais'
                : `Détail des frais (${detail.fraisDetail.length})`}
            </button>
          </div>
          {detailFraisOuvert && (
            <Tableau
              colonnes={COLONNES_FRAIS_DETAIL}
              lignes={detail.fraisDetail}
              cleLigne={(l) => l.id}
              etatVide={
                <EtatVide
                  variante="normal"
                  texte="Aucune ligne de détail pour ces frais — voir le message ci-dessus."
                />
              }
            />
          )}
        </>
      )}
      {/* Kilomètres RÉELLEMENT parcourus (D-064), saisis à la clôture — Trou 1
          (audit du 30/07/2026) : le champ était saisi et stocké, mais une
          session close ne l'affichait jamais. `null` = non renseigné, jamais
          0 (`ouTiret` rend un tiret, jamais « 0 km ») : un zéro laisserait
          croire à une session sans déplacement, gratuite en carburant et en
          usure. */}
      <LigneMetrique
        libelle="Kilomètres réels (tournée)"
        valeur={ouTiret(detail.distanceReelleKm, formaterKm)}
      />
      {/* Imputation FIGÉE de la tournée réelle entre la session et les achats
          (D-064 point 4, migration 0027) : jamais recalculée à la lecture —
          voir `services/sessions.ts::cloturerSession` pour le raisonnement
          (un des intrants, le coût kilométrique mesuré, dérive sans date de
          validité). `null` = pas calculable, jamais 0 (`ouTiret` rend un
          tiret) : un zéro laisserait croire à une tournée ou un détour
          gratuits. */}
      <LigneMetrique
        libelle="Déplacement réel — part session"
        valeur={ouTiret(detail.coutDeplacementReelSessionCents, formaterEuros)}
      />
      <LigneMetrique
        libelle="Déplacement réel — détour achats"
        valeur={ouTiret(detail.coutDeplacementReelDetourAchatsCents, formaterEuros)}
      />
      <LigneMetrique
        libelle="Déplacement réel — total tournée"
        valeur={ouTiret(detail.coutDeplacementReelTotalCents, formaterEuros)}
      />
      <LigneMetrique
        libelle="Marge brute"
        valeur={ouTiret(detail.margeBruteCents, formaterEuros)}
      />
      <LigneMetrique
        libelle="Marge nette"
        valeur={ouTiret(detail.margeNetteCents, formaterEuros)}
      />
      <LigneMetrique
        libelle="Marge nette par heure"
        valeur={ouTiret(detail.margeParHeureCents, formaterEuros)}
      />
      <LigneMetrique
        libelle="Panier moyen"
        valeur={ouTiret(detail.panierMoyenCents, formaterEuros)}
      />
      <LigneMetrique
        libelle="Coût matière par crêpe"
        valeur={ouTiret(detail.coutMatiereParCrepeCents, formaterEuros)}
      />
      <LigneMetrique
        libelle="Coût complet par crêpe vendue"
        valeur={ouTiret(detail.coutCompletParCrepeVendueCents, formaterEuros)}
      />
      <LigneMetrique
        libelle="Taux d'écoulement"
        valeur={ouTiret(detail.tauxEcoulementBp, formaterPourcent)}
      />
      {/* `null` = session régulière, le cas majoritaire (fiche 14) : rien à
          afficher plutôt qu'une ligne vide. */}
      {detail.evenementNom !== null && (
        <p className="flex items-baseline justify-between border-b border-line px-4 py-2 text-sm">
          <span className="text-ink-2">Opportunité</span>
          <span className="text-ink">{detail.evenementNom}</span>
        </p>
      )}
      <p className="flex items-baseline justify-between border-b border-line px-4 py-2 text-sm">
        <span className="text-ink-2">Écart de caisse</span>
        {detail.ecartCaisseCents === null ? (
          <span className="num text-ink">{TIRET_ABSENT}</span>
        ) : (
          rendreEcartCaisse(detail.ecartCaisseCents)
        )}
      </p>
      <LigneMetrique
        libelle="Produites / vendues / invendues / cassées"
        valeur={`${detail.crepesProduites} / ${detail.crepesVendues} / ${detail.crepesInvendues} / ${detail.crepesCassees}`}
      />
      {/* `modeCloture` est `null` sur les sessions closes avant D-057 : on
          n'affiche alors rien plutôt que de supposer un mode « crêpes »
          jamais choisi (§ rétrocompatibilité — NULL veut dire « on ne sait
          pas », pas « compté à la main »). */}
      {detail.modeCloture === 'volume' && detail.volumeRestantMesureMl !== null && (
        <p className="border-b border-line px-4 py-2 text-sm text-ink-2">
          Clôturée sur mesure de pâte : {formaterQuantite(detail.volumeRestantMesureMl, 'ml')}{' '}
          restants → {detail.crepesProduites} crêpes déduites.
        </p>
      )}

      <div className="border-b border-line px-4 pt-3 pb-1">
        <h3 className="text-2xs uppercase text-ink-3">Ventes</h3>
      </div>
      <Tableau
        colonnes={COLONNES_VENTES_DETAIL}
        lignes={ventesAffichees}
        cleLigne={(v) => v.cleSynthetique}
        etatVide={<EtatVide variante="normal" texte="Aucune vente enregistrée." />}
      />

      {(detail.notesQualitatives !== null || detail.motifExclusion !== null) && (
        <div className="px-4 py-2 text-sm text-ink-2">
          {detail.notesQualitatives !== null && <p>Notes : {detail.notesQualitatives}</p>}
          {detail.motifExclusion !== null && (
            <p>Exclue du modèle de prévision — motif : {detail.motifExclusion}</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Même formule que `formaterCoutAppelIa` (`ProchaineSession.tsx`) : le coût
 * d'un appel Claude se lit au moment où on le déclenche, pas sur l'écran
 * séparé « Assistance IA » qui, lui, montre le budget du MOIS (CLAUDE.md §0 :
 * « chaque écran fait une chose »). Redéfinie ICI plutôt qu'importée : aucune
 * page de ce dépôt n'en importe une autre en production (seuls les tests le
 * font, sur leur propre écran) — une ligne ne justifie pas de coupler deux
 * routes chargées indépendamment.
 */
export function formaterCoutAppelIa(coutCents: number): string {
  return `Coût de cet appel : ${formaterEuros(coutCents)}.`;
}

type EtatAnalyseEcart =
  | { statut: 'inactif' }
  | { statut: 'en_cours' }
  | { statut: 'recu'; commentaire: CommentaireIa }
  | { statut: 'erreur'; message: string };

/**
 * Analyse d'écart Claude, à la demande (mission du 31/07/2026).
 *
 * `POST /ia/analyse-ecart/:id` (`apps/api/src/routes/ia.ts:81`) existait,
 * testée, garde-fou « session non clôturée » compris, et n'était appelée par
 * AUCUN écran — exactement le motif de D-087 (« deux capacités existent,
 * testées, aucun écran ne les appelle »), appliqué cette fois à un usage
 * Claude plutôt qu'à une annulation.
 *
 * PLACÉ ICI et pas ailleurs : c'est le dimanche soir, sur LA session qu'on
 * vient de clôturer, qu'on se demande « pourquoi cet écart entre le prévu et
 * le réalisé » — jamais sur un écran séparé (docs/07 §0, « chaque écran fait
 * une chose »). Le bouton vit dans le même panneau que le rapport de session
 * PDF juste au-dessus, sur le même garde-fou (`raisonIndisponibleAnalyseEcart`).
 *
 * NI CHARGÉ AUTOMATIQUEMENT NI SUR OUVERTURE DU PANNEAU (CLAUDE.md §5) :
 * chaque appel coûte de l'argent réel au porteur, donc rien ne part sans un
 * clic explicite. L'indisponibilité — pas de clé, plafond atteint, panne — est
 * un état NORMAL affiché tel quel, jamais une erreur (même registre que
 * `CommentaireClaude`, `ProchaineSession.tsx` — `demanderCommentaire`,
 * `apps/api/src/ia/client.ts`, ne lève jamais : elle rend toujours
 * `{ disponible: false, raison }`).
 *
 * RESET SUR CHANGEMENT DE SESSION : ce composant reste monté tant que le
 * panneau « Détail de la session » reste ouvert, mais l'utilisateur peut
 * sélectionner une AUTRE session sans le fermer (`selectionnerSession`) — sans
 * le `useEffect` ci-dessous, un commentaire reçu pour la session précédente
 * resterait affiché sous le nom de la nouvelle, ce qui est exactement le genre
 * de confusion que CLAUDE.md §7 interdit (une valeur doit toujours être
 * rattachée à ce qu'elle décrit réellement).
 */
export function AnalyseEcartClaude({
  sessionId,
  raisonIndisponible,
}: {
  readonly sessionId: string;
  readonly raisonIndisponible: string | undefined;
}) {
  const [etat, setEtat] = useState<EtatAnalyseEcart>({ statut: 'inactif' });

  useEffect(() => {
    setEtat({ statut: 'inactif' });
  }, [sessionId]);

  const demander = async (): Promise<void> => {
    if (raisonIndisponible !== undefined) return;
    setEtat({ statut: 'en_cours' });
    try {
      const brut = await requeteApi<unknown>(`/ia/analyse-ecart/${sessionId}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setEtat({ statut: 'recu', commentaire: schemaCommentaireIa.parse(brut) });
    } catch (erreur) {
      setEtat({
        statut: 'erreur',
        message:
          erreur instanceof ErreurApi ? erreur.message : 'L’analyse n’a pas pu être demandée.',
      });
    }
  };

  const inerte = etat.statut === 'en_cours' || raisonIndisponible !== undefined;

  return (
    <div className="border-t border-line px-4 py-3">
      <h3 className="mb-groupe text-2xs uppercase text-ink-3">Analyse d’écart (Claude)</h3>

      {etat.statut === 'inactif' && (
        <div className="flex items-center justify-between gap-bloc">
          <p className="text-sm text-ink-3">
            {raisonIndisponible ??
              'Claude peut proposer des hypothèses sur l’écart entre le prévu et le réalisé. Il ne recalcule rien.'}
          </p>
          <button
            type="button"
            onClick={() => void demander()}
            aria-disabled={inerte}
            {...(raisonIndisponible !== undefined ? { title: raisonIndisponible } : {})}
            className={`h-controle shrink-0 rounded-sm border border-line-field px-3 text-sm text-ink-2 hover:bg-surface-sunken ${
              inerte ? 'cursor-not-allowed opacity-60' : ''
            }`}
          >
            Demander une analyse
          </button>
        </div>
      )}

      {etat.statut === 'en_cours' && <p className="text-sm text-ink-3">Claude réfléchit…</p>}

      {etat.statut === 'recu' && etat.commentaire.disponible && (
        <div className="flex flex-col gap-groupe">
          <div className="whitespace-pre-wrap text-sm text-ink-2">{etat.commentaire.texte}</div>
          <p className="text-xs text-ink-3">{formaterCoutAppelIa(etat.commentaire.coutCents)}</p>
        </div>
      )}

      {etat.statut === 'recu' && !etat.commentaire.disponible && (
        <p className="text-sm text-ink-3">{etat.commentaire.raison}</p>
      )}

      {etat.statut === 'erreur' && <p className="text-sm text-depassement">{etat.message}</p>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Colonnes des tableaux de consultation (liste des sessions, seuils légaux)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Le taux de vendu/produit portait trois habillages différents selon
 * l'écran (audit visuel du 30/07/2026, `docs/23-AUDIT-VISUEL.md` §3.1) :
 * « ÉCOULEMENT » en entier sur le Tableau de bord — tronqué par CSS à
 * largeur étroite, `ÉCOULE…` — et « ÉCOUL. » ici même. Trois traitements
 * pour le même manque de place, alors qu'une abréviation CHOISIE et STABLE
 * bat une troncature qui dépend de la largeur du navigateur et coupe où
 * elle veut.
 *
 * `LIBELLE_ECOULEMENT` et `titreEcoulement` vivaient dupliqués mot pour mot
 * ici et dans `TableauDeBord.tsx` (aucun module commun n'était dans le
 * périmètre d'écriture de cette mission-là) : consolidés depuis dans
 * `packages/core/src/affichage.ts`, seul module partagé par les deux
 * écrans. Ré-exportés ici pour ne rien changer aux imports existants
 * (`Sessions.test.tsx`).
 *
 * Le mot entier ne vivait QUE dans l'infobulle de chaque VALEUR (`titre`,
 * `composants/Tableau.tsx`) : l'en-tête réaffichait sa propre abréviation
 * au survol (`title={colonne.libelle}`, `Tableau.tsx:172`), faute d'un
 * champ distinct pour le porter. `libelleLong`, ajouté depuis à
 * `ColonneTableau`, comble ce manque ci-dessous — l'en-tête dit ce que
 * CONTIENT la colonne, la cellule dit la VALEUR, et les deux infobulles
 * coexistent.
 */
export { LIBELLE_ECOULEMENT, titreEcoulement };

const COLONNES_SESSIONS: ReadonlyArray<ColonneTableau<SessionResume>> = [
  {
    cle: 'date',
    libelle: 'Date',
    largeur: '14%',
    alignement: 'texte',
    rendu: (s) => `${formaterDate(s.dateSession)}${s.exclureDuModele ? ' *' : ''}`,
    titre: (s) =>
      s.exclureDuModele
        ? `${formaterDate(s.dateSession)} — exclue du modèle de prévision`
        : formaterDate(s.dateSession),
  },
  {
    cle: 'lieu',
    libelle: 'Lieu',
    largeur: '18%',
    alignement: 'texte',
    rendu: (s) => s.lieuNom,
    titre: (s) => s.lieuNom,
  },
  {
    cle: 'statut',
    libelle: 'Statut',
    largeur: '14%',
    alignement: 'texte',
    rendu: (s) => <PastilleStatutSession statut={s.statut} />,
  },
  {
    cle: 'ca',
    libelle: 'CA (€)',
    largeur: '13%',
    alignement: 'nombre',
    rendu: (s) => ouTiret(s.caTotalCents, formaterMontant),
  },
  {
    cle: 'marge',
    libelle: 'Marge (€)',
    largeur: '13%',
    alignement: 'nombre',
    rendu: (s) => ouTiret(s.margeNetteCents, formaterMontant),
  },
  {
    cle: 'ecoulement',
    libelle: LIBELLE_ECOULEMENT,
    libelleLong: LIBELLE_ECOULEMENT_LONG,
    largeur: '11%',
    alignement: 'nombre',
    rendu: (s) => ouTiret(s.tauxEcoulementBp, formaterPourcent),
    titre: (s) => titreEcoulement(s.tauxEcoulementBp),
  },
  {
    cle: 'ecart',
    libelle: 'Écart caisse (€)',
    largeur: '17%',
    alignement: 'nombre',
    rendu: (s) =>
      s.ecartCaisseCents === null ? TIRET_ABSENT : rendreEcartCaisse(s.ecartCaisseCents),
  },
];

export const COLONNES_SEUILS: ReadonlyArray<ColonneTableau<CompteurSeuilContrat>> = [
  {
    cle: 'libelle',
    libelle: 'Seuil',
    largeur: '22%',
    alignement: 'texte',
    // `repli`, jamais l'ellipse (D-081) : c'est la colonne IDENTIFIANTE de ce
    // tableau (quel seuil concerne la ligne), au meme titre qu'un numero de
    // lot. Le libelle le plus long — « Caisse enregistreuse certifiee (SCE) »
    // — est precisement celui que docs/07 §6.7 et CLAUDE.md §6 designent comme
    // le plus susceptible de surprendre le porteur : le couper en ellipse
    // masquerait le seul seuil qui bascule de 0 % a obligatoire sans prevenir.
    // `titre` reste pose en complement (confort souris), mais ce n'est pas lui
    // qui rend le libelle accessible au clavier — voir Tableau.tsx.
    troncature: 'repli',
    rendu: (s) => s.libelle,
    titre: (s) => s.libelle,
  },
  {
    cle: 'realise',
    libelle: 'Réalisé / plafond (€)',
    largeur: '24%',
    alignement: 'nombre',
    // `troncature: 'repli'` : la ligne « Franchise TVA » ajoute une seconde
    // ligne (voir ci-dessous), que le `truncate` par defaut aurait coupee en
    // ellipse — exactement le defaut deja corrige sur la colonne `libelle`
    // (D-081). Les trois autres seuils, sans deuxieme ligne, restent a 32 px :
    // seule la rangee qui deborde reellement grandit.
    troncature: 'repli',
    rendu: (s) => (
      <span className="flex flex-col items-end">
        <span>{`${formaterMontant(s.realiseCents)} / ${formaterMontant(s.plafondCents)}`}</span>
        {/* Second ETAGE du MEME seuil (docs/07 §6.6), jamais une ligne
            separee : `toleranceE604b` n'existe que sur la ligne « Franchise
            TVA » (`null` ailleurs, voir CompteurSeuilEnrichi), et s'affiche
            ici, SOUS le plafond de 25 000 € qu'il qualifie — pas a cote,
            pas dans une colonne a part, pas sur une rangee de plus. Le
            statut ('conforme'/'alerte'/'depassement') reutilise le MEME
            vocabulaire glyphe+couleur que le reste de l'ecran (aucune
            couleur ni glyphe nouveau, CLAUDE.md/docs/07). */}
        {s.toleranceE604b !== null && (
          <span className={`text-2xs ${CLASSE_TEXTE_STATUT[s.toleranceE604b.statut]}`}>
            <span aria-hidden="true">{GLYPHE_STATUT[s.toleranceE604b.statut]}</span> tolérance{' '}
            {formaterMontant(s.toleranceE604b.plafondCents)}
          </span>
        )}
      </span>
    ),
  },
  {
    cle: 'part',
    libelle: 'Part',
    largeur: '12%',
    alignement: 'nombre',
    rendu: (s) => formaterPourcent(s.partBp),
  },
  {
    cle: 'projection',
    libelle: "Projection fin d'année (€)",
    largeur: '22%',
    alignement: 'nombre',
    rendu: (s) => ouTiret(s.projectionFinAnneeCents, formaterMontant),
  },
  {
    cle: 'trajectoire',
    libelle: 'Trajectoire',
    largeur: '20%',
    alignement: 'texte',
    rendu: (s) =>
      s.projectionFinAnneeCents === null ? (
        <span className="text-ink-3">Historique insuffisant</span>
      ) : (
        <PastilleStatut
          statut={s.depassementProjete ? 'depassement' : 'conforme'}
          libelle={s.depassementProjete ? 'Dépassement projeté' : 'Maîtrisée'}
        />
      ),
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   États d'écran
   ═══════════════════════════════════════════════════════════════════════════ */

type EtatListeSessions =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; sessions: SessionResume[]; total: number };

type EtatLieux =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; lieux: LieuMarcheContrat[] };

type EtatProduits =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; produits: ProduitVendable[] };

/**
 * Équipements électriques du stand (fiche 17, D-055) — chargés pour proposer
 * une durée d'utilisation par appareil à la clôture. Un échec laisse
 * simplement la section vide : la clôture reste entièrement possible sans
 * (mode dégradé, CLAUDE.md §5).
 */
type EtatEquipements =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; equipements: Equipement[] };

type EtatSeuils =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; tableau: TableauSeuils };

/**
 * Productions rattachees, chargees pour PRE-REMPLIR le nombre de crêpes
 * produites depuis la production plutôt que le redemander (docs/17 fiche 10) :
 * `resoudreCrepesProduites` derive déjà ce chiffre côté serveur quand des
 * productions sont rattachées, mais rien ne le montrait à l'écran avant la
 * clôture — l'utilisateur devait deviner ce que le serveur savait déjà.
 */
type EtatProductions =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; productions: ProductionResume[] };

type EtatDetail =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; detail: SessionDetail };

type EtatEcritureSimple =
  { statut: 'inactif' } | { statut: 'en_cours' } | { statut: 'erreur'; message: string };

type EtatEcritureAvecSucces =
  | { statut: 'inactif' }
  | { statut: 'en_cours' }
  | { statut: 'succes'; message: string }
  | { statut: 'erreur'; message: string };

export default function Sessions() {
  const navigate = useNavigate();

  // ─── Liste, référentiel, seuils ──────────────────────────────────────────
  const [etatListe, setEtatListe] = useState<EtatListeSessions>({ statut: 'chargement' });
  const [etatSeuils, setEtatSeuils] = useState<EtatSeuils>({ statut: 'chargement' });
  const [etatLieux, setEtatLieux] = useState<EtatLieux>({ statut: 'chargement' });
  /**
   * Distance de RÉFÉRENCE (aller simple, `lieu_marche.distance_km`) par lieu —
   * sert UNIQUEMENT à PRÉ-REMPLIR les kilomètres réels à 2× cette distance
   * (D-064 point 3), jamais à un calcul de coût, entièrement côté serveur.
   *
   * Chargée séparément de `/lieux` (routes/sessions.ts) : cette route ne rend
   * que cinq champs restreints (`schemaLieuMarche`) et PAS la distance — seul
   * `GET /referentiel/lieux` (routes/referentiel-ecriture.ts, hors zone
   * d'écriture de cet agent) la porte, avec les lieux inactifs en plus. Un
   * échec de chargement laisse la table vide : le champ des kilomètres réels
   * reste alors simplement VIDE au lieu de se pré-remplir — la clôture reste
   * entièrement possible (mode dégradé, CLAUDE.md §5).
   */
  const [distancesReferenceParLieu, setDistancesReferenceParLieu] = useState<
    Record<string, number | null>
  >({});
  /**
   * Mode de facturation et puissance disponible PAR LIEU (fiche 17, D-055) —
   * chargés en même temps que `distancesReferenceParLieu` (même route
   * `/referentiel/lieux`, même mode dégradé) : le formulaire de clôture doit
   * savoir si CE lieu fournit de l'électricité avant de proposer une seule
   * durée d'utilisation d'équipement. Une entrée absente (lieu pas encore
   * chargé, ou route en échec) se lit `undefined` côté consommateur, jamais
   * comme « pas d'électricité » — voir `electriciteDisponibleLieu`
   * (`@batte/core`), qui traite alors l'information comme INCONNUE et non
   * comme une absence.
   */
  const [electriciteParLieu, setElectriciteParLieu] = useState<
    Record<string, { facturationElectricite: FacturationElectricite | null }>
  >({});
  const [etatProduits, setEtatProduits] = useState<EtatProduits>({ statut: 'chargement' });
  const [etatEquipements, setEtatEquipements] = useState<EtatEquipements>({
    statut: 'chargement',
  });
  const [etatProductions, setEtatProductions] = useState<EtatProductions>({
    statut: 'chargement',
  });

  // ─── Création rapide ──────────────────────────────────────────────────────
  const [creationOuverte, setCreationOuverte] = useState(false);
  const [lieuIdCreation, setLieuIdCreation] = useState<string | null>(null);
  const [dateCreation, setDateCreation] = useState<string>(aujourdHui);
  const [fondsCreationSaisie, setFondsCreationSaisie] = useState<string>('0,00');
  const [etatCreation, setEtatCreation] = useState<EtatEcritureSimple>({ statut: 'inactif' });
  /**
   * Opportunité (fiche 14) à l'origine de la session, choisie à la CRÉATION —
   * un stand d'entreprise, un marché de Noël, une fête médiévale. Vide =
   * session régulière, le cas majoritaire. `evenementIdRattachementSaisie` ci-
   * dessous couvre le même geste mais APRÈS coup, sur une session déjà créée.
   */
  const [evenementIdCreation, setEvenementIdCreation] = useState<string>('');
  const [opportunitesDisponibles, setOpportunitesDisponibles] = useState<LigneOpportunite[]>([]);
  const [evenementIdRattachementSaisie, setEvenementIdRattachementSaisie] = useState<string>('');
  const [etatRattachementEvenement, setEtatRattachementEvenement] = useState<EtatEcritureSimple>({
    statut: 'inactif',
  });

  // ─── Édition / clôture ────────────────────────────────────────────────────
  const [sessionEnEditionId, setSessionEnEditionId] = useState<string | null>(null);
  const [etatEdition, setEtatEdition] = useState<EtatDetail | null>(null);
  const [quantitesCatalogue, setQuantitesCatalogue] = useState<Record<string, string>>({});
  const [lignesLibres, setLignesLibres] = useState<LigneLibre[]>([]);
  const [especesCompteesSaisie, setEspecesCompteesSaisie] = useState('');
  const [caCarteSaisie, setCaCarteSaisie] = useState('');
  const [fondsCaisseSaisie, setFondsCaisseSaisie] = useState('');
  // Tickets releves sur le terminal SumUp — seule source du panier moyen
  // (D-039, docs/17 fiche 11). Vide = non compte : le panier moyen reste
  // `null`, jamais un chiffre calcule sur des articles et donc faux de moitie.
  const [nbTicketsSaisie, setNbTicketsSaisie] = useState('');
  /**
   * Deux façons de déclarer la production, au choix (demande du porteur) :
   * compter les crêpes, ou mesurer le volume de pâte restant dans le bac —
   * l'application déduit alors les crêpes produites (`resoudreCrepesDepuisVolumeRestant`).
   * « Invendues » et « Cassées » restent saisies à la main dans LES DEUX cas :
   * pâte non utilisée et crêpe cuite puis jetée sont deux pertes différentes.
   */
  const [modeProduction, setModeProduction] = useState<'crepes' | 'volume'>('crepes');
  const [crepesProduitesSaisie, setCrepesProduitesSaisie] = useState('');
  const [volumeRestantSaisie, setVolumeRestantSaisie] = useState('');
  const [uniteVolumeRestant, setUniteVolumeRestant] = useState<'ml' | 'g'>('ml');
  const [crepesInvenduesSaisie, setCrepesInvenduesSaisie] = useState('');
  const [crepesCasseesSaisie, setCrepesCasseesSaisie] = useState('');
  const [fraisEmplacementSaisie, setFraisEmplacementSaisie] = useState('');
  const [fraisDeplacementSaisie, setFraisDeplacementSaisie] = useState('');
  const [fraisGazSaisie, setFraisGazSaisie] = useState('');
  const [fraisDiversSaisie, setFraisDiversSaisie] = useState('');
  /**
   * Justificatif (ticket, facture) de chaque frais, en Data URI — voir la
   * section « Justificatif (ticket) d'un frais de session » plus haut.
   * Jamais reconstitué depuis `detail` en rouvrant une clôture existante :
   * rattaché MAINTENANT, pas après coup (même doctrine que `nbTicketsSaisie`
   * et les relevés de température ci-dessous) — le contrat de clôture ne
   * relit de toute façon pas cette saisie.
   */
  const [justificatifsFraisSaisie, setJustificatifsFraisSaisie] = useState<
    Record<CategorieFraisAvecJustificatif, string | null>
  >({ ...JUSTIFICATIFS_FRAIS_VIDES });
  const [erreursJustificatifsFrais, setErreursJustificatifsFrais] = useState<
    Record<CategorieFraisAvecJustificatif, string | null>
  >({ ...ERREURS_JUSTIFICATIFS_FRAIS_VIDES });
  /**
   * Kilomètres RÉELS de la tournée (D-064) : PAS un aller-retour automatique,
   * un champ entièrement LIBRE — pré-rempli à l'ouverture de la clôture à 2×
   * la distance de référence du lieu quand elle est connue (voir
   * `initialiserFormulaireEdition`), et laissé VIDE (jamais 0) sinon.
   */
  const [distanceReelleSaisie, setDistanceReelleSaisie] = useState('');
  /**
   * Durée d'utilisation (minutes) PAR ÉQUIPEMENT électrique, saisie à la
   * clôture (fiche 17) — clé = `equipement.id`, valeur vide = appareil non
   * utilisé cette session-ci. Jamais reconstitué depuis `detail` à l'ouverture
   * d'une clôture existante : même raison que `nbTicketsSaisie` et les
   * relevés de température ci-dessous — `SessionDetail` ne porte pas cette
   * saisie (elle vit dans `equipement_session`, pas dans `session_marche`).
   */
  const [dureesEquipementsSaisie, setDureesEquipementsSaisie] = useState<Record<string, string>>(
    {},
  );
  const [heureDebutSaisie, setHeureDebutSaisie] = useState('');
  const [heureFinSaisie, setHeureFinSaisie] = useState('');
  /**
   * Relevés de température (docs/17 fiche 17), rattachés à CETTE session.
   * Jamais reconstitués depuis `detail` à l'ouverture d'une clôture existante
   * — même raison que `nbTicketsSaisie` : ce sont deux registres séparés,
   * et un champ température ne se pré-remplit jamais (voir RegistreAfsca.tsx).
   */
  const [releveArriveeSaisie, setReleveArriveeSaisie] =
    useState<SaisieReleveTemperature>(RELEVE_TEMPERATURE_VIDE);
  const [releveRetourSaisie, setReleveRetourSaisie] =
    useState<SaisieReleveTemperature>(RELEVE_TEMPERATURE_VIDE);
  const [notesSaisie, setNotesSaisie] = useState('');
  const [exclureDuModele, setExclureDuModele] = useState(false);
  const [motifExclusionSaisie, setMotifExclusionSaisie] = useState('');
  const [estModifie, setEstModifie] = useState(false);
  const [heureEnregistrement, setHeureEnregistrement] = useState<string | null>(null);
  const [etatCloture, setEtatCloture] = useState<'inactif' | 'en_cours'>('inactif');
  /**
   * Un SEUL point d'affichage, mais deux natures de refus.
   *
   * Quinze de ces refus sont des validations de saisie décidées ICI, sans
   * réseau (« le fonds de caisse doit être un montant valide ») : le porteur a
   * un geste à faire, c'est une alerte MÉTIER. Le seizième vient du `catch` de
   * l'appel de clôture, et là tout dépend de la réponse — un 422 est un refus
   * raisonné qui dit quoi corriger (le menu dont les prix désignés dépassent le
   * prix pratiqué, D-093), un 500 ou une coupure réseau ne demandent rien.
   *
   * L'audit du 01/08/2026 avait laissé cet écran intact faute de pouvoir
   * séparer les deux depuis un simple `string`. Porter la nature DANS l'état
   * règle le problème à la source, sans dupliquer le point de rendu.
   */
  const [erreurCloture, setErreurCloture] = useState<{
    message: string;
    nature: NatureRefus;
  } | null>(null);

  /**
   * Refus de SAISIE : toujours métier, jamais technique — ces contrôles ne
   * touchent pas au réseau, ils lisent ce qui est tapé à l'écran.
   */
  function refuserSaisieCloture(message: string): void {
    setErreurCloture({ message, nature: 'metier' });
  }
  /** Detail du calcul quand la DERNIERE clôture a résolu les crêpes depuis un
   *  volume mesuré. `null` sinon — jamais persisté (§0 : pièce comptable
   *  figée), seulement affiché juste après l'enregistrement. */
  const [resolutionVolumeDerniereCloture, setResolutionVolumeDerniereCloture] =
    useState<ResolutionVolumeContrat | null>(null);
  /**
   * Imputation de la tournée réelle entre la session et les achats (D-064
   * point 4, Trou 2 — audit du 30/07/2026, refermé le même jour) : calculée
   * ET PERSISTÉE à CHAQUE clôture (`services/sessions.ts::cloturerSession`,
   * migration 0027) — voir sa doc pour le raisonnement complet (pourquoi
   * figer plutôt que recalculer). Contrairement à `resolutionVolumeDerniereCloture`
   * ci-dessus, cette valeur N'EST PLUS éphémère : `BlocDetailSession` l'affiche
   * aussi, depuis `detail.coutDeplacementReel*Cents`, y compris en rouvrant
   * une session déjà close (`GET /sessions/:id`). Ce state-ci reste un simple
   * MIROIR de commodité pour le bandeau affiché juste après l'enregistrement.
   */
  const [imputationDeplacementDerniereCloture, setImputationDeplacementDerniereCloture] =
    useState<ImputationDeplacementContrat | null>(null);
  /**
   * Écarts de stock à la vente (D-037) constatés à la DERNIÈRE clôture —
   * tableau VIDE (jamais `null` : `ResultatCloture.ecartsStock` n'est pas
   * nullable, c'est une liste, possiblement vide) quand le stock enregistré
   * couvrait tout ce qui a été vendu. Non vide quand un produit revendu a été
   * vendu au-delà de ce que le stock traçable pouvait couvrir — la vente est
   * quand même enregistrée (D-037 : c'est le stock qui a tort, pas la vente).
   * ÉPHÉMÈRE, même convention que les states voisins ci-dessus/ci-dessous :
   * jamais persisté pour lui-même, jamais reconstitué en rouvrant une
   * clôture existante — voir `formaterAvertissementEcartsStock` plus haut
   * pour la mise en forme du bandeau.
   */
  const [ecartsStockDerniereCloture, setEcartsStockDerniereCloture] = useState<
    readonly EcartStockVente[]
  >([]);
  /**
   * Avertissement d'électricité (fiche 17) de la DERNIÈRE clôture — `null`
   * quand le coût d'électricité retenu est une valeur CERTAINE (mesuré, ou
   * zéro certain : aucune électricité sur ce lieu, ou déjà comptée dans
   * l'emplacement/le forfait). Non-`null` quand ce coût a été compté 0 par
   * prudence faute de donnée. ÉPHÉMÈRE comme les deux states ci-dessus :
   * jamais persisté pour lui-même, jamais reconstitué en rouvrant une
   * clôture existante.
   */
  const [avertissementEnergieDerniereCloture, setAvertissementEnergieDerniereCloture] = useState<
    string | null
  >(null);
  /**
   * Avertissement « marge brute à 100 % sans que rien ne le signale » (audit
   * du 30/07/2026) de la DERNIÈRE clôture — `null` quand un coût matière
   * transformé a réellement été retenu (même partiel), OU quand la session
   * n'a vendu QUE du revendu (un coût transformé nul y est alors la vérité,
   * pas une anomalie). Non-`null` quand du transformé a été vendu SANS aucun
   * coût matière retenu pour lui — voir `coutMatiereTransformeSuspect`
   * (`@batte/core`) pour le seuil de déclenchement. ÉPHÉMÈRE, même
   * convention que `avertissementEnergieDerniereCloture` ci-dessus.
   */
  const [
    avertissementCoutMatiereTransformeDerniereCloture,
    setAvertissementCoutMatiereTransformeDerniereCloture,
  ] = useState<string | null>(null);
  /**
   * Nombre de relevés de température (arrivée + retour) effectivement SAISIS
   * à la DERNIÈRE clôture soumise (mission AFSCA du 30/07/2026) — voir
   * `formaterAvertissementReleveTemperatureAbsent` plus haut pour la mise en
   * forme du bandeau. `null` = aucune clôture soumise durant cette édition
   * (jamais 0 par défaut : 0 déclenche le bandeau, `null` ne doit jamais le
   * faire avant qu'une vraie clôture n'ait eu lieu). ÉPHÉMÈRE, même
   * convention que les trois states voisins ci-dessus : jamais reconstitué en
   * rouvrant une clôture existante — un relevé ne se rattache qu'À la
   * clôture elle-même (voir la doc de la fonction de mise en forme).
   */
  const [nombreRelevesTemperatureDerniereCloture, setNombreRelevesTemperatureDerniereCloture] =
    useState<number | null>(null);

  // ─── Lecture seule (sessions clôturées / annulées) ───────────────────────
  const [sessionLectureSeuleId, setSessionLectureSeuleId] = useState<string | null>(null);
  const [etatDetailLectureSeule, setEtatDetailLectureSeule] = useState<EtatDetail | null>(null);
  const [revelerAnnulation, setRevelerAnnulation] = useState(false);
  const [motifAnnulationSaisie, setMotifAnnulationSaisie] = useState('');
  const [etatAnnulation, setEtatAnnulation] = useState<EtatEcritureAvecSucces>({
    statut: 'inactif',
  });

  // ─── Navigation clavier du tableau de ventes ─────────────────────────────
  const refsQte = useRef<Array<HTMLInputElement | null>>([]);
  const aFocaliserProchaineLigneRef = useRef(false);
  const indexAFocaliserApresSuppressionRef = useRef<number | null>(null);
  // Le panneau « Nouvelle session » est séparé de son bouton déclencheur par
  // TOUT le tableau des seuils légaux : sans ce rappel de focus, ouvrir la
  // création oblige à traverser un tableau entier à la tabulation pour
  // atteindre le premier champ.
  const champLieuCreation = useRef<HTMLSelectElement>(null);
  // « Annuler cette session » remplace le bouton focalisé par ce champ : sans
  // rappel, le focus retombe sur `<body>` au moment précis où l'on demande à
  // l'utilisateur de justifier une écriture d'annulation.
  const champMotifAnnulationSession = useRef<HTMLInputElement>(null);
  /**
   * « Fermer » du panneau de lecture seule — cible de focus après une
   * ANNULATION réussie (D-079, complément du 01/08/2026). Le bouton qui vient
   * d'agir disparaît avec son formulaire (`setRevelerAnnulation(false)`), et
   * le bloc entier disparaît avec le statut qui passe à `annulee` : sans cette
   * reprise, le focus retombe sur `<body>` au moment précis où l'on vient
   * d'annuler une pièce comptable.
   */
  const boutonFermerLectureSeuleRef = useRef<HTMLButtonElement>(null);
  const aFocaliseOuvertureRef = useRef<string | null>(null);
  // Pré-remplissage du nombre de crêpes produites depuis les productions
  // rattachées (docs/17 fiche 10) : ne se déclenche qu'UNE FOIS par ouverture
  // de session, sinon il écraserait une correction que l'utilisateur vient de
  // taper dès que `etatProductions` change de référence.
  const aPrerempliProductionRef = useRef<string | null>(null);
  const cloturerSessionRef = useRef<() => void>(() => {});
  // Le bouton « Enregistrer » (Ctrl+S) se DÉSACTIVE le temps de l'aller-retour
  // (`disabled={etatCloture === 'en_cours'}` plus bas) : un bouton qui perd
  // `disabled` PENDANT qu'il a le focus est blur par le navigateur lui-même,
  // avant que React ne s'en mêle — le focus retombe sur `<body>` (recette au
  // navigateur du 31/07/2026, rejouée après la campagne de correctifs, sur
  // l'écran de clôture précisément). Même patron que `boutonSortir`
  // (`Stock.tsx`, D-079) : `requestAnimationFrame` reprend le focus une fois
  // le DOM réactivé.
  const boutonEnregistrerClotureRef = useRef<HTMLButtonElement>(null);
  // Cible de focus après une clôture RÉUSSIE (défaut réel corrigé le
  // 01/08/2026) : `boutonEnregistrerClotureRef` ne convient plus une fois la
  // session close — ce bouton vit sous `editionEstOuverte`, qui devient FAUX
  // exactement au rendu qui suit un succès (`detailEdition.statut` passe de
  // `planifiee` à `cloturee`), donc ce bouton est DÉMONTÉ au moment même où on
  // voudrait le refocaliser. Le bouton « Fermer » de la vue « Clôture
  // enregistrée » qui le remplace, lui, existe encore à cet instant : c'est le
  // seul contrôle actionnable du panneau juste après l'enregistrement (même
  // patron que `boutonFermerDetailRef` dans `Production.tsx`).
  const boutonFermerClotureRef = useRef<HTMLButtonElement>(null);

  // ─── Chargements ──────────────────────────────────────────────────────────

  function chargerListeSessions(): void {
    setEtatListe({ statut: 'chargement' });
    requeteApi<unknown>('/sessions')
      .then((reponse) => {
        const liste = schemaListeSessions.parse(reponse);
        setEtatListe({ statut: 'pret', sessions: liste.data, total: liste.meta.total });
      })
      .catch((erreur: unknown) => {
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatListe({ statut: 'erreur', message });
      });
  }

  function chargerSeuils(): void {
    setEtatSeuils({ statut: 'chargement' });
    requeteApi<unknown>('/seuils')
      .then((reponse) => {
        const tableau = schemaTableauSeuils.parse(reponse);
        setEtatSeuils({ statut: 'pret', tableau });
      })
      .catch((erreur: unknown) => {
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatSeuils({ statut: 'erreur', message });
      });
  }

  /** Rechargee a l'ouverture d'une clôture : une production peut avoir été
   * lancée ou rattachée depuis le dernier chargement au montage. */
  function chargerProductions(): void {
    requeteApi<unknown>('/productions')
      .then((reponse) => {
        const liste = schemaListeProductions.parse(reponse);
        setEtatProductions({ statut: 'pret', productions: liste.data });
      })
      .catch((erreur: unknown) => {
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatProductions({ statut: 'erreur', message });
      });
  }

  useEffect(() => {
    chargerListeSessions();
  }, []);

  useEffect(() => {
    chargerSeuils();
  }, []);

  useEffect(() => {
    chargerProductions();
  }, []);

  useEffect(() => {
    let annule = false;
    requeteApi<unknown>('/lieux')
      .then((reponse) => {
        const lieux = analyserEnveloppe(reponse, schemaLieuMarche, '/api/lieux');
        if (annule) return;
        setEtatLieux({ statut: 'pret', lieux });
        const premier = lieux[0];
        if (premier !== undefined) setLieuIdCreation(premier.id);
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatLieux({ statut: 'erreur', message });
      });
    return () => {
      annule = true;
    };
  }, []);

  // Distances de référence par lieu — voir la doc de `distancesReferenceParLieu`
  // ci-dessus. Chargement séparé de `/lieux`, indépendant : un échec ici ne
  // doit jamais empêcher la création ni la clôture d'une session, seulement
  // priver le pré-remplissage des kilomètres réels de sa valeur de départ.
  // Alimente AUSSI `electriciteParLieu` (fiche 17, D-055) : même route, même
  // mode dégradé — un échec laisse simplement la disponibilité électrique
  // INCONNUE pour chaque lieu, jamais lue comme une absence.
  useEffect(() => {
    let annule = false;
    requeteApi<unknown>('/referentiel/lieux')
      .then((reponse) => {
        if (annule) return;
        const lieux = schemaListeLieuxComplets.parse(reponse).data;
        const parLieu: Record<string, number | null> = {};
        const electriciteParLieuChargee: Record<
          string,
          { facturationElectricite: FacturationElectricite | null }
        > = {};
        for (const lieu of lieux) {
          parLieu[lieu.id] = lieu.distanceKm;
          electriciteParLieuChargee[lieu.id] = {
            facturationElectricite: lieu.facturationElectricite,
          };
        }
        setDistancesReferenceParLieu(parLieu);
        setElectriciteParLieu(electriciteParLieuChargee);
      })
      .catch(() => {
        // Mode dégradé : voir la doc de `distancesReferenceParLieu`.
      });
    return () => {
      annule = true;
    };
  }, []);

  useEffect(() => {
    let annule = false;
    requeteApi<unknown>('/produits-vendables')
      .then((reponse) => {
        const produits = analyserEnveloppe(
          reponse,
          schemaProduitVendable,
          '/api/produits-vendables',
        );
        if (!annule) setEtatProduits({ statut: 'pret', produits });
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatProduits({ statut: 'erreur', message });
      });
    return () => {
      annule = true;
    };
  }, []);

  /**
   * Équipements électriques (fiche 17) — pour proposer une durée d'utilisation
   * par appareil à la clôture. Un échec laisse la section vide : la clôture
   * reste entièrement possible sans (mode dégradé, CLAUDE.md §5).
   */
  useEffect(() => {
    let annule = false;
    requeteApi<unknown>('/equipements')
      .then((reponse) => {
        if (annule) return;
        const liste = schemaListeEquipements.parse(reponse);
        setEtatEquipements({ statut: 'pret', equipements: liste.data });
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        const message =
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
        setEtatEquipements({ statut: 'erreur', message });
      });
    return () => {
      annule = true;
    };
  }, []);

  /**
   * Opportunités (fiche 14) pouvant motiver une session — pour le sélecteur
   * de création et celui de rattachement après coup. Un échec laisse
   * simplement les deux sélecteurs vides (mode dégradé, même convention que
   * `chargerLieux` dans `Opportunites.tsx`) : la session reste créable et
   * clôturable sans jamais dépendre de cette liste.
   */
  useEffect(() => {
    let annule = false;
    requeteApi<unknown>('/opportunites')
      .then((reponse) => {
        if (annule) return;
        setOpportunitesDisponibles(schemaListeOpportunites.parse(reponse).data);
      })
      .catch(() => {
        if (!annule) setOpportunitesDisponibles([]);
      });
    return () => {
      annule = true;
    };
  }, []);

  // Succès transitoire de l'annulation : 5 s puis retour à l'inactif
  // (docs/07 §4.7). C'est une écriture ponctuelle, pas un écran sauvegardé
  // vingt fois : le bandeau transitoire reste ici le bon choix, à la
  // différence de l'indicateur PERSISTANT de la clôture elle-même.
  useEffect(() => {
    if (etatAnnulation.statut !== 'succes') return;
    const minuteur = window.setTimeout(() => setEtatAnnulation({ statut: 'inactif' }), 5000);
    return () => window.clearTimeout(minuteur);
  }, [etatAnnulation]);

  // ─── Données dérivées (aide à la frappe uniquement) ──────────────────────

  const produitsVendables: ProduitVendable[] =
    etatProduits.statut === 'pret' ? etatProduits.produits : [];
  const produitsParId = new Map<string, ProduitVendable>(
    produitsVendables.map((p): [string, ProduitVendable] => [p.id, p]),
  );

  const { lignes: lignesVenteConstruites, erreur: erreurVentesEnCours } = construireLignesVente(
    produitsVendables,
    quantitesCatalogue,
    lignesLibres,
  );
  const totauxVentes = totaliserVentes(versLigneVenteCore(lignesVenteConstruites, produitsParId));

  const especesValeur = parserEuros(especesCompteesSaisie);
  const carteValeur = parserEuros(caCarteSaisie);
  const fondsValeur = parserEuros(fondsCaisseSaisie);
  /**
   * `especesValeur` et `carteValeur` sont transmis TELS QUELS, `null` compris
   * — jamais rattrapés par `?? 0`. Un formulaire de clôture vierge (rien
   * encore compté) affichait sinon un écart de caisse de −50,00 € avant la
   * moindre frappe : `rapprocherCaisse` (`@batte/core`) propage désormais
   * l'inconnu jusqu'à `ecartCaisseCents`, qui reste `null` tant que l'un des
   * deux comptages manque (voir `rendreEcartCaisse` plus bas, qui affiche
   * alors `TIRET_ABSENT` comme le fait déjà `BlocDetailSession`).
   *
   * `fondsValeur` garde son `?? 0` : le fonds de caisse a un vrai zéro par
   * défaut (« aucune monnaie emportée »), et le champ est systématiquement
   * pré-rempli depuis la session à l'ouverture de la clôture (voir plus bas) —
   * à la différence des espèces et de la carte, qui ne sont JAMAIS pré-remplis
   * et valent donc réellement « pas encore compté » sur un formulaire vierge.
   */
  const resultatCaisse = rapprocherCaisse(
    {
      fondsCaisseInitialCents: fondsValeur ?? 0,
      especesCompteesCents: especesValeur,
      caCarteCents: carteValeur,
    },
    totauxVentes.caTotalCents,
  );

  const invenduesValeur = parserEntierNonNegatifOuVide(crepesInvenduesSaisie);
  const casseesValeur = parserEntierNonNegatifOuVide(crepesCasseesSaisie);

  // Productions rattachées à la session en édition (docs/17 fiche 10) : sert
  // uniquement à INFORMER — le pré-remplissage lui-même est posé par l'effet
  // dédié, et le serveur reste seul juge à l'enregistrement. Calculé depuis
  // `etatEdition` directement : `detailEdition` n'est déclaré que plus bas
  // dans le composant.
  const sessionIdEnEdition =
    etatEdition !== null && etatEdition.statut === 'pret' ? etatEdition.detail.id : null;
  const productionsRattacheesEnCours: ProductionResume[] =
    etatProductions.statut === 'pret' && sessionIdEnEdition !== null
      ? etatProductions.productions.filter(
          (p) => p.sessionId === sessionIdEnEdition && p.statut !== 'annulee',
        )
      : [];
  const crepesProduitesDeriveesEnCours =
    productionsRattacheesEnCours.length === 0
      ? null
      : productionsRattacheesEnCours.reduce(
          (total, p) => total + (p.crepesReelles ?? p.crepesTheoriques),
          0,
        );

  /**
   * Mode « crêpes » : saisie directe, inchangée.
   */
  const produitesValeur = parserEntierNonNegatifOuVide(crepesProduitesSaisie);

  /**
   * Mode « volume » : APERÇU côté client de ce que le serveur va calculer,
   * en réutilisant la MÊME fonction pure que `cloturerSession` côté serveur
   * (règle n°1, CLAUDE.md §3) — jamais une formule réécrite ici. Rendu sous
   * forme de résultat/erreur plutôt que de laisser l'exception remonter :
   * c'est de l'aide à la frappe, elle ne doit jamais faire planter l'écran
   * pendant que le champ est encore vide ou incohérent.
   */
  const volumeRestantValeur = parserEntierNonNegatifOuVide(volumeRestantSaisie);
  const apercuVolume: ResolutionCrepesParVolume | { erreur: string } | null =
    modeProduction !== 'volume' || volumeRestantValeur === null
      ? null
      : (() => {
          try {
            // `convertir` (pas contournée) refuse les grammes : aucune densité
            // de pâte n'est déclarée dans le modèle. L'aperçu doit refuser
            // EXACTEMENT comme le serveur, jamais traiter un nombre de
            // grammes comme s'il s'agissait de millilitres.
            const volumeRestantMl = convertir(volumeRestantValeur, uniteVolumeRestant, 'ml');
            return resoudreCrepesDepuisVolumeRestant(
              productionsRattacheesEnCours.map((p) => ({
                volumeProduitMl: p.volumeReelMl ?? p.volumeTheoriqueMl,
                crepesProduites: p.crepesReelles ?? p.crepesTheoriques,
              })),
              volumeRestantMl,
            );
          } catch (erreur) {
            if (erreur instanceof ErreurMetier && erreur.code === 'densite_manquante') {
              return {
                erreur:
                  "Les grammes ne sont pas pris en charge : aucune densité de pâte n'est " +
                  "déclarée dans l'application. Saisissez ce volume en millilitres.",
              };
            }
            return { erreur: erreur instanceof ErreurMetier ? erreur.message : String(erreur) };
          }
        })();
  const apercuVolumeErreur =
    apercuVolume !== null && 'erreur' in apercuVolume ? apercuVolume.erreur : null;

  const crepesProduitesEnCours =
    modeProduction === 'crepes'
      ? (produitesValeur ?? 0)
      : apercuVolume !== null && !('erreur' in apercuVolume)
        ? apercuVolume.crepesProduites
        : 0;

  const productionEnCours: ProductionSession = {
    crepesProduites: crepesProduitesEnCours,
    crepesVendues: totauxVentes.crepesVendues,
    crepesInvendues: invenduesValeur ?? 0,
    crepesCassees: casseesValeur ?? 0,
  };
  const ecartProductionEnCours = ecartProduction(productionEnCours);
  // `null` et non 0 quand rien n'a encore ete produit (saisie en cours d'une
  // session qui ne vend que du revendu, ou champ pas encore rempli) :
  // `ratioEnPointsDeBase` rend 0 sur un denominateur nul, ce qui afficherait
  // « 0 % d'ecoulement » — un invendu total — la ou la question ne se pose
  // pas encore. Meme garde que `calculerRentabilite` cote serveur.
  const tauxEcoulementEnCours =
    productionEnCours.crepesProduites === 0
      ? null
      : ratioEnPointsDeBase(productionEnCours.crepesVendues, productionEnCours.crepesProduites);

  // Ticket compté au terminal, ou rien : `parserEntierNonNegatifOuVide` rend
  // 0 sur une saisie vide, converti en `null` (« pas compté ») juste avant
  // l'envoi — voir `cloturerSession`.
  const nbTicketsValeur = parserEntierNonNegatifOuVide(nbTicketsSaisie);

  // Kilomètres réels (D-064) : calculé au niveau du composant, comme les
  // valeurs ci-dessus, pour que le champ affiche un contour d'erreur EN
  // DIRECT sur une saisie illisible, sans attendre le clic sur « Enregistrer ».
  const distanceReelleValeur = parserDistanceReelleOptionnelle(distanceReelleSaisie);

  /**
   * Équipements électriques PROPOSABLES à la clôture (fiche 17) : ACTIFS et
   * EN SERVICE seulement — un appareil déclaré `enService: false` ne sert
   * qu'à comparer un achat (docs/demandes/17, « comparer avant d'acheter »),
   * il n'a jamais tourné sur aucune session.
   */
  const equipementsDisponibles: Equipement[] =
    etatEquipements.statut === 'pret'
      ? etatEquipements.equipements.filter((e) => e.actif && e.enService)
      : [];

  /**
   * Disponibilité électrique du LIEU de la session en édition (D-055) —
   * calculée depuis `etatEdition` directement, comme `sessionIdEnEdition`
   * ci-dessus : `detailEdition` n'est déclaré que plus bas dans le composant.
   * `null` = INCONNUE (lieu pas encore chargé, ou attribut non renseigné),
   * JAMAIS lu comme « disponible » ni comme « absente » — voir
   * `electriciteDisponibleLieu` (`@batte/core`, même doctrine que D-055 :
   * aucune valeur par défaut optimiste, dans aucun des deux sens).
   */
  const lieuIdEnEditionCours =
    etatEdition !== null && etatEdition.statut === 'pret' ? etatEdition.detail.lieuId : null;
  const electriciteDisponibleLieuEnCours = electriciteDisponibleLieu(
    lieuIdEnEditionCours !== null
      ? (electriciteParLieu[lieuIdEnEditionCours]?.facturationElectricite ?? null)
      : null,
  );

  const nbLignesTotal = produitsVendables.length + lignesLibres.length;

  // ─── Focus clavier ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!aFocaliserProchaineLigneRef.current) return;
    aFocaliserProchaineLigneRef.current = false;
    refsQte.current[nbLignesTotal - 1]?.focus();
  }, [nbLignesTotal]);

  // Après une suppression de ligne libre, le focus revient dans la grille (voir
  // `supprimerLigneLibre`). L'effet se déclenche une fois la rangée réellement
  // démontée, donc `refsQte` est déjà réindexé.
  useEffect(() => {
    const index = indexAFocaliserApresSuppressionRef.current;
    if (index === null) return;
    indexAFocaliserApresSuppressionRef.current = null;
    const cible = Math.min(index, nbLignesTotal - 1);
    if (cible >= 0) refsQte.current[cible]?.focus();
  }, [nbLignesTotal]);

  useEffect(() => {
    if (etatEdition === null || etatEdition.statut !== 'pret') return;
    if (etatEdition.detail.statut !== 'planifiee') return;
    if (aFocaliseOuvertureRef.current === etatEdition.detail.id) return;
    if (produitsVendables.length === 0) return;
    aFocaliseOuvertureRef.current = etatEdition.detail.id;
    refsQte.current[0]?.focus();
  }, [etatEdition, produitsVendables.length]);

  /**
   * Pré-remplit « Produites » depuis les productions rattachées (docs/17
   * fiche 10), au lieu de laisser l'écran redemander un chiffre que le
   * serveur DÉRIVE déjà — `resoudreCrepesProduites` refuse toute valeur qui
   * diverge dès qu'une production est rattachée, mais rien ne montrait avant
   * cette pré-saisie ce que le serveur allait imposer.
   */
  useEffect(() => {
    if (etatEdition === null || etatEdition.statut !== 'pret') return;
    const detail = etatEdition.detail;
    if (detail.statut !== 'planifiee') return;
    if (etatProductions.statut !== 'pret') return;
    if (aPrerempliProductionRef.current === detail.id) return;
    aPrerempliProductionRef.current = detail.id;

    const rattachees = etatProductions.productions.filter(
      (p) => p.sessionId === detail.id && p.statut !== 'annulee',
    );
    if (rattachees.length === 0) return;
    const derive = rattachees.reduce(
      (total, p) => total + (p.crepesReelles ?? p.crepesTheoriques),
      0,
    );
    setCrepesProduitesSaisie(String(derive));
  }, [etatEdition, etatProductions]);

  // Ctrl+S clôture (docs/06 : la maquette n'a qu'un bouton « Enregistrer »).
  // La référence évite un effet qui se réabonnerait à chaque frappe tout en
  // appelant toujours la version la plus récente de `cloturerSession`.
  useEffect(() => {
    if (sessionEnEditionId === null) return;
    function gererClavier(evenement: globalThis.KeyboardEvent): void {
      if ((evenement.ctrlKey || evenement.metaKey) && evenement.key.toLowerCase() === 's') {
        evenement.preventDefault();
        cloturerSessionRef.current();
      }
    }
    window.addEventListener('keydown', gererClavier);
    return () => window.removeEventListener('keydown', gererClavier);
  }, [sessionEnEditionId]);

  // ─── Initialisation du formulaire d'édition ──────────────────────────────

  function initialiserFormulaireEdition(
    detail: SessionDetail,
    defautsLieu: {
      tarifEmplacementCents: number | null;
      heureDebut: string | null;
      heureFin: string | null;
    } | null,
  ): void {
    setQuantitesCatalogue({});
    setLignesLibres([]);
    setEspecesCompteesSaisie(
      detail.especesCompteesCents !== null ? formaterMontant(detail.especesCompteesCents) : '',
    );
    setCaCarteSaisie(detail.caCarteCents !== null ? formaterMontant(detail.caCarteCents) : '');
    setFondsCaisseSaisie(formaterMontant(detail.fondsCaisseInitialCents));
    // Jamais reconstitue depuis `detail` : une session non close ne porte
    // aucun ticket, et une session close est en lecture seule (D-024).
    setNbTicketsSaisie('');
    // Le MODE est un concept d'écran, jamais persisté (seul `crepesProduites`
    // résolu l'est) : rouvrir une clôture repart toujours en mode « crêpes »,
    // pré-rempli comme avant cette fonctionnalité.
    setModeProduction('crepes');
    setCrepesProduitesSaisie(String(detail.crepesProduites));
    setVolumeRestantSaisie('');
    setUniteVolumeRestant('ml');
    setCrepesInvenduesSaisie(String(detail.crepesInvendues));
    setCrepesCasseesSaisie(String(detail.crepesCassees));
    // Frais d'emplacement : pré-rempli SEULEMENT quand un montant est connu —
    // celui déjà porté par la session, sinon le tarif de référence du lieu.
    // Laissé VIDE (jamais « 0,00 ») quand aucun des deux ne l'est, exactement
    // comme les kilomètres réels plus bas et pour la même raison : un champ
    // pré-rempli se valide sans être lu dans une clôture au clavier, et
    // « 0,00 » se relit ensuite « emplacement gratuit » alors que la vérité
    // est « tarif jamais renseigné ». Ce montant remonte aux frais de la
    // session, puis au résultat net, puis au compteur du seuil INASTI.
    //
    // Un tarif de lieu VALANT 0 reste pré-rempli à « 0,00 » : c'est un vrai
    // zéro, mesuré et saisi par le porteur (emplacement effectivement
    // gratuit). Seule l'ABSENCE de tarif laisse le champ vide.
    const emplacementDefautCents =
      detail.fraisEmplacementCents > 0
        ? detail.fraisEmplacementCents
        : (defautsLieu?.tarifEmplacementCents ?? null);
    setFraisEmplacementSaisie(
      emplacementDefautCents === null ? '' : formaterMontant(emplacementDefautCents),
    );
    setFraisDeplacementSaisie(formaterMontant(detail.fraisDeplacementCents));
    setFraisGazSaisie(formaterMontant(detail.fraisGazCents));
    setFraisDiversSaisie(formaterMontant(detail.fraisDiversCents));
    // Jamais reconstitué depuis `detail` : un justificatif se rattache
    // MAINTENANT, pas après coup (même doctrine que `nbTicketsSaisie` et les
    // relevés de température ci-dessous).
    setJustificatifsFraisSaisie({ ...JUSTIFICATIFS_FRAIS_VIDES });
    setErreursJustificatifsFrais({ ...ERREURS_JUSTIFICATIFS_FRAIS_VIDES });
    // Kilomètres réels (D-064) : PAS d'interrupteur aller-retour, un champ
    // entièrement LIBRE — « tu dois laisser libre ce champ afin que je puisse
    // par exemple aller du marché à un autre marché ou chez des fournisseurs »
    // (le porteur, séance du 30/07/2026). Pré-rempli à 2× la distance de
    // RÉFÉRENCE du lieu quand elle est connue — légitime ici, contrairement à
    // la distance du lieu elle-même (D-064 point 2, refusée explicitement),
    // car il dérive d'un chiffre que le porteur a lui-même saisi. Laissé VIDE
    // (jamais 0) quand cette distance est inconnue : un 0 ferait croire à une
    // session sans déplacement, donc gratuite en carburant et en usure.
    //
    // Toujours recalculé depuis `distancesReferenceParLieu`, jamais depuis
    // `detail` : cette fonction n'initialise que des sessions `planifiee`/
    // `en_cours` (une session `cloturee` passe par la vue lecture seule), pour
    // lesquelles `distance_reelle_km` est encore `null` en base.
    const distanceReferenceLieuKm = distancesReferenceParLieu[detail.lieuId] ?? null;
    setDistanceReelleSaisie(
      // `formaterKmPourSaisie`, pas `String(...)` (D-074) : la distance de
      // référence peut désormais porter une décimale, et `parserDistanceReelle
      // Optionnelle` doit relire la même virgule française que le reste de
      // l'écran, pas un point anglo-saxon.
      distanceReferenceLieuKm === null ? '' : formaterKmPourSaisie(distanceReferenceLieuKm * 2),
    );
    // Jamais reconstitué depuis `detail` : la durée d'utilisation vit dans
    // `equipement_session`, pas dans `session_marche` — même raison que les
    // relevés de température ci-dessous.
    setDureesEquipementsSaisie({});
    setHeureDebutSaisie(detail.heureDebutReelle ?? defautsLieu?.heureDebut ?? '');
    setHeureFinSaisie(detail.heureFinReelle ?? defautsLieu?.heureFin ?? '');
    // Jamais reconstitué depuis `detail` : les relevés vivent dans leur propre
    // registre, pas dans `SessionDetail`, et une température ne se pré-remplit
    // jamais (docs/17 fiche 17, même raison que `nbTicketsSaisie` ci-dessus).
    setReleveArriveeSaisie(RELEVE_TEMPERATURE_VIDE);
    setReleveRetourSaisie(RELEVE_TEMPERATURE_VIDE);
    setNotesSaisie(detail.notesQualitatives ?? '');
    setExclureDuModele(detail.exclureDuModele);
    setMotifExclusionSaisie(detail.motifExclusion ?? '');
    setEstModifie(false);
    setHeureEnregistrement(null);
    setErreurCloture(null);
    setEtatCloture('inactif');
    setResolutionVolumeDerniereCloture(null);
    setImputationDeplacementDerniereCloture(null);
    setEcartsStockDerniereCloture([]);
    setAvertissementEnergieDerniereCloture(null);
    setAvertissementCoutMatiereTransformeDerniereCloture(null);
    setNombreRelevesTemperatureDerniereCloture(null);
    // Sélecteur de rattachement (fiche 14) : un concept d'ÉCRAN, jamais
    // reconstitué depuis `detail` — `detail.evenementId` porte déjà le lien
    // existant, ce sélecteur ne sert qu'à EN POSER un nouveau.
    setEvenementIdRattachementSaisie('');
    setEtatRattachementEvenement({ statut: 'inactif' });
    aFocaliseOuvertureRef.current = null;
    aPrerempliProductionRef.current = null;
    setEtatEdition({ statut: 'pret', detail });
    setSessionEnEditionId(detail.id);
    setCreationOuverte(false);
    setSessionLectureSeuleId(null);
    setEtatDetailLectureSeule(null);
  }

  function confirmerAbandonSiModifie(): boolean {
    if (sessionEnEditionId === null || !estModifie) return true;
    return window.confirm('Des modifications non enregistrées seront perdues. Continuer ?');
  }

  function fermerEdition(): void {
    if (
      estModifie &&
      !window.confirm('Des modifications non enregistrées seront perdues. Fermer quand même ?')
    )
      return;
    setSessionEnEditionId(null);
    setEtatEdition(null);
  }

  function ouvrirCreation(): void {
    if (!confirmerAbandonSiModifie()) return;
    setSessionEnEditionId(null);
    setEtatEdition(null);
    setSessionLectureSeuleId(null);
    setEtatDetailLectureSeule(null);
    setDateCreation(aujourdHui());
    setFondsCreationSaisie('0,00');
    setEvenementIdCreation('');
    setEtatCreation({ statut: 'inactif' });
    setCreationOuverte(true);
  }

  useEffect(() => {
    if (creationOuverte) champLieuCreation.current?.focus();
  }, [creationOuverte]);

  useEffect(() => {
    if (revelerAnnulation) champMotifAnnulationSession.current?.focus();
  }, [revelerAnnulation]);

  async function creerSession(): Promise<void> {
    if (lieuIdCreation === null) {
      setEtatCreation({ statut: 'erreur', message: 'Sélectionnez un lieu de marché.' });
      return;
    }
    if (dateCreation === '') {
      setEtatCreation({ statut: 'erreur', message: 'La date de session est obligatoire.' });
      return;
    }
    const fondsValeurCreation = parserEurosOuZero(fondsCreationSaisie);
    if (fondsValeurCreation === null) {
      setEtatCreation({
        statut: 'erreur',
        message: 'Le fonds de caisse initial doit être un montant valide.',
      });
      return;
    }
    if (etatCreation.statut === 'en_cours') return;

    setEtatCreation({ statut: 'en_cours' });
    try {
      const corps = {
        lieuId: lieuIdCreation,
        dateSession: dateCreation,
        fondsCaisseInitialCents: fondsValeurCreation,
        // Opportunité (fiche 14) à l'origine de la session — absente du corps
        // plutôt qu'envoyée vide : `evenementId` reste alors `null` côté
        // serveur (session régulière, le cas majoritaire).
        ...(evenementIdCreation === '' ? {} : { evenementId: evenementIdCreation }),
      };
      const reponse = await requeteApi<unknown>('/sessions', {
        method: 'POST',
        body: JSON.stringify(corps),
      });
      const detail = schemaSessionDetail.parse(reponse);
      const lieuChoisi =
        etatLieux.statut === 'pret'
          ? (etatLieux.lieux.find((l) => l.id === lieuIdCreation) ?? null)
          : null;
      initialiserFormulaireEdition(
        detail,
        lieuChoisi === null
          ? null
          : {
              tarifEmplacementCents: lieuChoisi.tarifEmplacementCents,
              heureDebut: lieuChoisi.heureDebut,
              heureFin: lieuChoisi.heureFin,
            },
      );
      setEtatCreation({ statut: 'inactif' });
      setEvenementIdCreation('');
      chargerListeSessions();
    } catch (erreur: unknown) {
      const message =
        erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
      setEtatCreation({ statut: 'erreur', message });
    }
  }

  async function ouvrirEditionExistante(resume: SessionResume): Promise<void> {
    if (sessionEnEditionId === resume.id) {
      fermerEdition();
      return;
    }
    if (!confirmerAbandonSiModifie()) return;
    setSessionLectureSeuleId(null);
    setEtatDetailLectureSeule(null);
    setSessionEnEditionId(resume.id);
    setEtatEdition({ statut: 'chargement' });
    chargerProductions();
    try {
      const reponse = await requeteApi<unknown>(`/sessions/${resume.id}`);
      const detail = schemaSessionDetail.parse(reponse);
      initialiserFormulaireEdition(detail, null);
    } catch (erreur: unknown) {
      const message =
        erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
      setEtatEdition({ statut: 'erreur', message });
    }
  }

  async function ouvrirLectureSeule(resume: SessionResume): Promise<void> {
    if (sessionLectureSeuleId === resume.id) {
      setSessionLectureSeuleId(null);
      setEtatDetailLectureSeule(null);
      return;
    }
    setRevelerAnnulation(false);
    setMotifAnnulationSaisie('');
    setEtatAnnulation({ statut: 'inactif' });
    setSessionLectureSeuleId(resume.id);
    setEtatDetailLectureSeule({ statut: 'chargement' });
    try {
      const reponse = await requeteApi<unknown>(`/sessions/${resume.id}`);
      const detail = schemaSessionDetail.parse(reponse);
      setEtatDetailLectureSeule({ statut: 'pret', detail });
    } catch (erreur: unknown) {
      const message =
        erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
      setEtatDetailLectureSeule({ statut: 'erreur', message });
    }
  }

  function selectionnerSession(resume: SessionResume): void {
    if (resume.statut === 'planifiee') {
      void ouvrirEditionExistante(resume);
    } else {
      void ouvrirLectureSeule(resume);
    }
  }

  // ─── Lignes de vente : ajout, suppression, navigation clavier ────────────

  function ajouterLigneLibre(focaliser: boolean): void {
    const premierProduit = produitsVendables[0];
    if (premierProduit === undefined) return;
    const nouvelleLigne: LigneLibre = {
      clientId: crypto.randomUUID(),
      produitId: premierProduit.id,
      quantiteSaisie: '',
      prixUnitaireSaisie: formaterMontant(premierProduit.prixCents),
    };
    if (focaliser) aFocaliserProchaineLigneRef.current = true;
    setLignesLibres((precedent) => [...precedent, nouvelleLigne]);
    setEstModifie(true);
  }

  /**
   * `index` est l'indice de la ligne dans la grille COMPLÈTE (catalogue +
   * lignes libres), le même que celui de `refsQte`. Il sert uniquement à
   * replacer le focus : le bouton « Supprimer » démonte sa propre rangée, donc
   * sans ce rappel le focus retombe sur `<body>` AU MILIEU de la grille de
   * saisie — l'endroit du produit où le perdre coûte le plus cher (docs/07
   * §4.6, mode tableur). On revient sur le champ Quantité de la rangée qui
   * prend la place, ou de la précédente si on vient de supprimer la dernière.
   */
  function supprimerLigneLibre(clientId: string, index: number): void {
    setLignesLibres((precedent) => precedent.filter((l) => l.clientId !== clientId));
    setEstModifie(true);
    indexAFocaliserApresSuppressionRef.current = index;
  }

  function changerQuantiteCatalogue(produitId: string, valeur: string): void {
    setQuantitesCatalogue((precedent) => ({ ...precedent, [produitId]: valeur }));
    setEstModifie(true);
  }

  function changerLigneLibreProduit(clientId: string, produitId: string): void {
    setLignesLibres((precedent) =>
      precedent.map((ligne) => {
        if (ligne.clientId !== clientId) return ligne;
        const produit = produitsParId.get(produitId);
        return {
          ...ligne,
          produitId,
          prixUnitaireSaisie:
            produit !== undefined ? formaterMontant(produit.prixCents) : ligne.prixUnitaireSaisie,
        };
      }),
    );
    setEstModifie(true);
  }

  function changerLigneLibreQuantite(clientId: string, quantiteSaisie: string): void {
    setLignesLibres((precedent) =>
      precedent.map((l) => (l.clientId === clientId ? { ...l, quantiteSaisie } : l)),
    );
    setEstModifie(true);
  }

  function changerLigneLibrePrix(clientId: string, prixUnitaireSaisie: string): void {
    setLignesLibres((precedent) =>
      precedent.map((l) => (l.clientId === clientId ? { ...l, prixUnitaireSaisie } : l)),
    );
    setEstModifie(true);
  }

  /**
   * `Entrée` descend TOUJOURS vers le champ Quantité de la ligne suivante,
   * en créant une ligne libre si on est sur la dernière (voir le commentaire
   * d'en-tête du fichier). `Tab` n'est PAS géré ici : l'ordre du DOM suffit.
   */
  function gererEntreeLigne(index: number, evenement: KeyboardEvent<HTMLElement>): void {
    if (evenement.key !== 'Enter') return;
    evenement.preventDefault();
    if (index + 1 < nbLignesTotal) {
      refsQte.current[index + 1]?.focus();
    } else {
      ajouterLigneLibre(true);
    }
  }

  /**
   * Lit le fichier choisi pour le justificatif d'UN frais et le convertit en
   * Data URI (`FileReader`). Rejette localement un format ou une taille non
   * conformes — mêmes règles que `validerPieceJointe` côté serveur
   * (`packages/db/src/services/factures.ts`), pour un retour immédiat plutôt
   * qu'un aller-retour réseau qui échouerait de toute façon. Un fichier
   * rejeté n'empêche jamais la clôture : le justificatif reste simplement
   * absent (`null`), l'erreur n'est qu'informative (même comportement que
   * `Factures.tsx`).
   */
  function surChangementJustificatifFrais(
    categorie: CategorieFraisAvecJustificatif,
    evenement: ChangeEvent<HTMLInputElement>,
  ): void {
    const fichier = evenement.target.files?.[0] ?? null;
    if (fichier === null) {
      setJustificatifsFraisSaisie((precedent) => ({ ...precedent, [categorie]: null }));
      setErreursJustificatifsFrais((precedent) => ({ ...precedent, [categorie]: null }));
      return;
    }
    if (!TYPES_MIME_PIECE_JOINTE_ACCEPTES.includes(fichier.type)) {
      setErreursJustificatifsFrais((precedent) => ({
        ...precedent,
        [categorie]:
          'Format non pris en charge : choisissez une image (JPEG, PNG, WEBP) ou un PDF.',
      }));
      setJustificatifsFraisSaisie((precedent) => ({ ...precedent, [categorie]: null }));
      evenement.target.value = '';
      return;
    }
    if (fichier.size > TAILLE_MAX_PIECE_JOINTE_OCTETS) {
      setErreursJustificatifsFrais((precedent) => ({
        ...precedent,
        [categorie]:
          `Fichier trop volumineux (maximum ` +
          `${Math.floor(TAILLE_MAX_PIECE_JOINTE_OCTETS / (1024 * 1024))} Mo).`,
      }));
      setJustificatifsFraisSaisie((precedent) => ({ ...precedent, [categorie]: null }));
      evenement.target.value = '';
      return;
    }

    const lecteur = new FileReader();
    lecteur.onload = () => {
      const resultat = lecteur.result;
      if (typeof resultat !== 'string') {
        setErreursJustificatifsFrais((precedent) => ({
          ...precedent,
          [categorie]: 'Impossible de lire ce fichier.',
        }));
        return;
      }
      setJustificatifsFraisSaisie((precedent) => ({ ...precedent, [categorie]: resultat }));
      setErreursJustificatifsFrais((precedent) => ({ ...precedent, [categorie]: null }));
    };
    lecteur.onerror = () => {
      setErreursJustificatifsFrais((precedent) => ({
        ...precedent,
        [categorie]: 'Impossible de lire ce fichier.',
      }));
    };
    lecteur.readAsDataURL(fichier);
    setEstModifie(true);
  }

  // ─── Clôture ──────────────────────────────────────────────────────────────

  async function cloturerSession(): Promise<void> {
    if (etatEdition === null || etatEdition.statut !== 'pret') return;
    const detail = etatEdition.detail;
    if (detail.statut === 'cloturee' || detail.statut === 'annulee') return;
    if (etatCloture === 'en_cours') return;

    if (erreurVentesEnCours !== null) {
      refuserSaisieCloture(erreurVentesEnCours);
      return;
    }
    if (especesValeur === null) {
      refuserSaisieCloture(
        "Le montant d'espèces comptées doit être un montant valide (0 si aucune espèce).",
      );
      return;
    }
    if (carteValeur === null) {
      refuserSaisieCloture(
        'Le montant encaissé par carte doit être un montant valide (0 si aucun paiement carte).',
      );
      return;
    }
    if (fondsValeur === null) {
      refuserSaisieCloture('Le fonds de caisse initial doit être un montant valide.');
      return;
    }
    const emplacementValeur = parserEurosOuZero(fraisEmplacementSaisie);
    const deplacementValeur = parserEurosOuZero(fraisDeplacementSaisie);
    const gazValeur = parserEurosOuZero(fraisGazSaisie);
    const diversValeur = parserEurosOuZero(fraisDiversSaisie);
    if (
      emplacementValeur === null ||
      deplacementValeur === null ||
      gazValeur === null ||
      diversValeur === null
    ) {
      refuserSaisieCloture('Un des montants de frais saisis est invalide.');
      return;
    }
    if (distanceReelleValeur === undefined) {
      refuserSaisieCloture(
        'Les kilomètres réels doivent être un nombre positif (ex. 46 ou 48,5), ou laissés ' +
          'vides si non renseignés.',
      );
      return;
    }
    if (invenduesValeur === null || casseesValeur === null) {
      refuserSaisieCloture(
        'Les compteurs d’invendues et de cassées doivent être des nombres entiers.',
      );
      return;
    }
    // Un seul des deux modes est validé : l'autre champ est simplement hors
    // jeu, ce n'est pas une saisie manquante.
    if (modeProduction === 'crepes' && produitesValeur === null) {
      refuserSaisieCloture('Le nombre de crêpes produites doit être un nombre entier.');
      return;
    }
    if (modeProduction === 'volume') {
      if (volumeRestantValeur === null) {
        refuserSaisieCloture('Le volume de pâte restant doit être un nombre entier.');
        return;
      }
      if (uniteVolumeRestant === 'g') {
        // `convertir` (utilisée par le serveur) refuserait de toute façon :
        // aucune densité de pâte n'est déclarée dans le modèle. Le dire ICI
        // évite un aller-retour réseau pour une réponse déjà connue.
        refuserSaisieCloture(
          "Les grammes ne sont pas pris en charge : aucune densité de pâte n'est déclarée " +
            "dans l'application. Saisissez ce volume en millilitres.",
        );
        return;
      }
      if (apercuVolumeErreur !== null) {
        refuserSaisieCloture(apercuVolumeErreur);
        return;
      }
    }
    if (nbTicketsValeur === null) {
      refuserSaisieCloture(
        'Le nombre de tickets doit être un entier positif (laissez le champ vide si vous ne ' +
          "l'avez pas compté).",
      );
      return;
    }

    // Relevés de température (docs/17 fiche 17) : optionnels, un moment à la
    // fois n'empêche jamais l'autre ni la clôture — seule une saisie PRÉSENTE
    // mais invalide (température illisible, équipement vide) est refusée.
    const releveArriveeConstruit = construireReleveTemperatureCloture(
      'arrivee',
      releveArriveeSaisie,
    );
    if (releveArriveeConstruit.statut === 'erreur') {
      refuserSaisieCloture(releveArriveeConstruit.message);
      return;
    }
    const releveRetourConstruit = construireReleveTemperatureCloture('retour', releveRetourSaisie);
    if (releveRetourConstruit.statut === 'erreur') {
      refuserSaisieCloture(releveRetourConstruit.message);
      return;
    }
    const relevesTemperature = [releveArriveeConstruit, releveRetourConstruit]
      .filter(
        (r): r is { statut: 'ok'; releve: ReleveTemperatureClotureConstruit } => r.statut === 'ok',
      )
      .map((r) => r.releve);

    /**
     * Équipements électriques utilisés (fiche 17) : construits UNIQUEMENT si
     * le lieu ne s'affiche pas explicitement sans électricité — défense en
     * profondeur, en plus de la section masquée à l'écran (voir le rendu
     * plus bas). Une durée non vide et illisible (pas un entier de minutes
     * strictement positif) bloque la clôture, exactement comme une
     * température illisible ci-dessus.
     */
    const equipementsUtilisesConstruits: { equipementId: string; dureeMinutes: number }[] = [];
    if (electriciteDisponibleLieuEnCours !== false) {
      for (const equipement of equipementsDisponibles) {
        const saisie = dureesEquipementsSaisie[equipement.id] ?? '';
        const duree = parserDureeEquipementOptionnelle(saisie);
        if (duree === undefined) {
          refuserSaisieCloture(
            `La durée d'utilisation de « ${equipement.nom} » doit être un nombre entier de ` +
              'minutes, ou laissée vide si non utilisé.',
          );
          return;
        }
        if (duree !== null) {
          equipementsUtilisesConstruits.push({ equipementId: equipement.id, dureeMinutes: duree });
        }
      }
    }

    const corps: ClotureSession = {
      ventes: lignesVenteConstruites,
      frais: {
        emplacementCents: emplacementValeur,
        deplacementCents: deplacementValeur,
        gazCents: gazValeur,
        diversCents: diversValeur,
      },
      // Kilomètres RÉELS de la tournée (D-064), déjà validé ci-dessus
      // (`distanceReelleValeur !== undefined` à ce stade) : `null` = non
      // renseigné, jamais 0 — voir la doc de `parserDistanceReelleOptionnelle`.
      distanceReelleKm: distanceReelleValeur,
      fondsCaisseInitialCents: fondsValeur,
      especesCompteesCents: especesValeur,
      caCarteCents: carteValeur,
      // `0` veut dire « champ laissé vide » (voir `nbTicketsValeur` ci-dessus) :
      // converti en `null`, jamais envoyé tel quel — `positive()` du contrat
      // refuserait un zéro.
      nbTickets: nbTicketsValeur === 0 ? null : nbTicketsValeur,
      // Un seul des deux champs est envoyé : le contrat refuse les deux à la
      // fois (`schemaClotureSession`), exactement comme cet écran ne montre
      // jamais les deux modes en même temps.
      ...(modeProduction === 'crepes'
        ? { crepesProduites: produitesValeur! }
        : { volumeRestantSaisi: { quantite: volumeRestantValeur!, unite: uniteVolumeRestant } }),
      crepesInvendues: invenduesValeur,
      crepesCassees: casseesValeur,
      heureDebutReelle: heureDebutSaisie.trim() === '' ? null : heureDebutSaisie,
      heureFinReelle: heureFinSaisie.trim() === '' ? null : heureFinSaisie,
      // Absent plutôt que `[]` quand rien n'est saisi : un tableau vide et un
      // champ absent valent la même chose côté serveur, mais un `undefined`
      // dit plus clairement « rien à envoyer » qu'un tableau vide construit.
      ...(relevesTemperature.length > 0 ? { relevesTemperature } : {}),
      // Équipements électriques utilisés (fiche 17) : même convention que
      // `relevesTemperature` ci-dessus — absent plutôt qu'un tableau vide.
      ...(equipementsUtilisesConstruits.length > 0
        ? { equipementsUtilises: equipementsUtilisesConstruits }
        : {}),
      notesQualitatives: notesSaisie.trim() === '' ? null : notesSaisie.trim(),
      exclureDuModele,
      motifExclusion:
        exclureDuModele && motifExclusionSaisie.trim() !== '' ? motifExclusionSaisie.trim() : null,
    };

    /**
     * Justificatifs des frais (ticket, facture), transmis À PART du contrat
     * partagé : `schemaClotureSession.frais` (`@batte/core`) ne les porte pas
     * (`apps/api/src/routes/sessions.ts` les relit dans la requête BRUTE,
     * même patron que `fichierScanPath` sur une facture ou une réception).
     * `corps` reste strictement conforme à `ClotureSession` ci-dessus ; ce
     * qui part sur le réseau est un OBJET DISTINCT — `JSON.stringify` ne
     * connaît pas la distinction TypeScript entre les deux.
     */
    const corpsEnvoye = {
      ...corps,
      frais: {
        ...corps.frais,
        emplacementJustificatifPath: justificatifsFraisSaisie.emplacement,
        deplacementJustificatifPath: justificatifsFraisSaisie.deplacement,
        gazJustificatifPath: justificatifsFraisSaisie.gaz,
        diversJustificatifPath: justificatifsFraisSaisie.divers,
      },
    };

    setErreurCloture(null);
    setEtatCloture('en_cours');
    try {
      const reponse = await requeteApi<unknown>(`/sessions/${detail.id}/cloturer`, {
        method: 'POST',
        body: JSON.stringify(corpsEnvoye),
      });
      const resultat = schemaResultatCloture.parse(reponse);
      setEtatEdition({ statut: 'pret', detail: resultat });
      // Affiché une seule fois, juste après l'enregistrement : ce n'est pas
      // une pièce comptable, seulement le détail du calcul qui vient de
      // produire `crepesProduites` (§0 : une session close est figée, sa
      // souplesse vaut pour la clôture, jamais en réécriture du passé).
      setResolutionVolumeDerniereCloture(resultat.resolutionVolume);
      setImputationDeplacementDerniereCloture(resultat.imputationDeplacement);
      setEcartsStockDerniereCloture(resultat.ecartsStock);
      setAvertissementEnergieDerniereCloture(resultat.avertissementEnergie);
      setAvertissementCoutMatiereTransformeDerniereCloture(
        resultat.avertissementCoutMatiereTransforme,
      );
      // Mission AFSCA du 30/07/2026 : combien de relevés de température
      // (arrivée + retour) viennent d'être réellement soumis dans CETTE
      // clôture — `relevesTemperature` ci-dessus, jamais recalculé depuis la
      // réponse serveur (ce n'est qu'un miroir de ce qui vient de partir,
      // accepté tel quel puisque la clôture entière aurait échoué sinon, voir
      // `cloturerSession`). Voir `formaterAvertissementReleveTemperatureAbsent`
      // plus haut pour ce que ce chiffre déclenche.
      setNombreRelevesTemperatureDerniereCloture(relevesTemperature.length);
      setEtatCloture('inactif');
      setEstModifie(false);
      setHeureEnregistrement(heureCourante());
      chargerListeSessions();
      chargerSeuils();
      // La clôture vient de réussir : `detailEdition.statut` n'est plus
      // `planifiee`, `editionEstOuverte` devient FAUX au prochain rendu, et
      // `boutonEnregistrerClotureRef` pointe donc vers un bouton qui va être
      // démonté — le focaliser ne ferait rien (défaut réel corrigé le
      // 01/08/2026, voir le commentaire de `boutonFermerClotureRef` plus
      // haut). La cible qui existe ENCORE après ce rendu est le bouton
      // « Fermer » de la vue « Clôture enregistrée » qui prend sa place.
      requestAnimationFrame(() => boutonFermerClotureRef.current?.focus());
    } catch (erreur: unknown) {
      const message =
        erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
      setEtatCloture('inactif');
      // La nature vient de la RÉPONSE, pas de l'endroit où l'on se trouve : un
      // 422 est un refus métier qui dit quoi corriger, un 500 ou une coupure
      // réseau ne demandent rien au porteur.
      setErreurCloture({ message, nature: natureDuRefus(erreur) });
      requestAnimationFrame(() => boutonEnregistrerClotureRef.current?.focus());
    }
  }

  cloturerSessionRef.current = () => {
    void cloturerSession();
  };

  async function annulerSession(sessionId: string): Promise<void> {
    const motif = motifAnnulationSaisie.trim();
    if (motif === '') {
      setEtatAnnulation({
        statut: 'erreur',
        message: 'Indiquez pourquoi cette session est annulée.',
      });
      return;
    }
    if (etatAnnulation.statut === 'en_cours') return;

    setEtatAnnulation({ statut: 'en_cours' });
    try {
      const reponse = await requeteApi<unknown>(`/sessions/${sessionId}/annuler`, {
        method: 'POST',
        body: JSON.stringify({ motif }),
      });
      const detailMisAJour = schemaSessionDetail.parse(reponse);
      setEtatDetailLectureSeule({ statut: 'pret', detail: detailMisAJour });
      setEtatAnnulation({ statut: 'succes', message: 'Session annulée.' });
      setRevelerAnnulation(false);
      setMotifAnnulationSaisie('');
      chargerListeSessions();
      chargerSeuils();
      // Seul contrôle encore actionnable du panneau à cet instant — voir la
      // doc de `boutonFermerLectureSeuleRef`.
      requestAnimationFrame(() => boutonFermerLectureSeuleRef.current?.focus());
    } catch (erreur: unknown) {
      const message =
        erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
      setEtatAnnulation({ statut: 'erreur', message });
    }
  }

  /**
   * Rattache la session EN ÉDITION à l'opportunité choisie (fiche 14),
   * après coup — refusé côté serveur si elle est déjà clôturée (D-059) :
   * le lien se pose avant, jamais après. Ne réinitialise PAS tout le
   * formulaire d'édition (`initialiserFormulaireEdition` le ferait) : seule
   * la fiche de session, dans `etatEdition`, est rafraîchie.
   */
  async function rattacherEvenement(sessionId: string, evenementId: string): Promise<void> {
    if (evenementId === '') return;
    if (etatRattachementEvenement.statut === 'en_cours') return;

    setEtatRattachementEvenement({ statut: 'en_cours' });
    try {
      await requeteApi(`/sessions/${sessionId}/rattacher-evenement`, {
        method: 'PATCH',
        body: JSON.stringify({ evenementId }),
      });
      const reponse = await requeteApi<unknown>(`/sessions/${sessionId}`);
      const detail = schemaSessionDetail.parse(reponse);
      setEtatEdition({ statut: 'pret', detail });
      setEvenementIdRattachementSaisie('');
      setEtatRattachementEvenement({ statut: 'inactif' });
    } catch (erreur: unknown) {
      const message = erreur instanceof ErreurApi ? erreur.message : 'Le rattachement a échoué.';
      setEtatRattachementEvenement({ statut: 'erreur', message });
    }
  }

  const detailEdition =
    etatEdition !== null && etatEdition.statut === 'pret' ? etatEdition.detail : null;
  const editionEstOuverte = detailEdition !== null && detailEdition.statut === 'planifiee';
  /** Calculé une seule fois par rendu (D-037) : voir `formaterAvertissementEcartsStock`. */
  const avertissementEcartsStock = formaterAvertissementEcartsStock(ecartsStockDerniereCloture);
  /**
   * Calculé une seule fois par rendu, même raison que ci-dessus : voir
   * `formaterAvertissementReleveTemperatureAbsent` (mission AFSCA du
   * 30/07/2026).
   */
  const avertissementReleveTemperatureAbsent = formaterAvertissementReleveTemperatureAbsent(
    nombreRelevesTemperatureDerniereCloture,
  );

  return (
    <div className="flex flex-col gap-bloc">
      <div className="flex h-barre items-center justify-between">
        <h1 className="text-lg text-ink">Sessions</h1>
        <button
          type="button"
          onClick={ouvrirCreation}
          // Le bouton commande un formulaire escamotable rendu plus bas : sans
          // `aria-expanded`, rien n'annonce au lecteur d'ecran que le panneau
          // vient de s'ouvrir, le focus n'ayant pas bouge.
          aria-expanded={creationOuverte}
          className="flex h-controle items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Nouvelle session
        </button>
      </div>

      {/* ═══ Seuils légaux ═══════════════════════════════════════════════ */}
      <Panneau titre="Seuils légaux" sansRembourrage>
        {etatSeuils.statut === 'chargement' && (
          <p className="px-4 py-2 text-sm text-ink-3">Chargement des seuils…</p>
        )}
        {etatSeuils.statut === 'erreur' && (
          <div className="px-4 py-2">
            <MessageErreur message={etatSeuils.message} />
          </div>
        )}
        {etatSeuils.statut === 'pret' && (
          <>
            <Tableau
              colonnes={COLONNES_SEUILS}
              lignes={etatSeuils.tableau.data}
              cleLigne={(s) => s.cle}
              etatVide={<EtatVide variante="normal" texte="Aucun seuil légal paramétré." />}
            />
            <p className="px-4 py-2 text-xs text-ink-3">
              Dont revente : {formaterEuros(etatSeuils.tableau.meta.caRevenduCents)} (
              {formaterPourcent(etatSeuils.tableau.meta.partRevenduBp)}) sur{' '}
              {etatSeuils.tableau.meta.sessionsTenues} session
              {etatSeuils.tableau.meta.sessionsTenues <= 1 ? '' : 's'} en{' '}
              {etatSeuils.tableau.meta.annee}.
            </p>
          </>
        )}
      </Panneau>

      {/* ═══ Création rapide ═════════════════════════════════════════════ */}
      {creationOuverte && (
        <Panneau titre="Nouvelle session">
          {/* Vrai `<form>` : ce panneau n'est PAS couvert par le `Ctrl+S` de la
              clôture (l'écouteur sort tant que `sessionEnEditionId` est nul,
              c'est-à-dire exactement pendant la création). Sans lui, ni
              `Entrée` ni `Ctrl+S` ne créaient la session. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void creerSession();
            }}
            className="flex flex-wrap items-end gap-bloc"
          >
            <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="creation-lieu">
              Lieu de marché
              <select
                id="creation-lieu"
                ref={champLieuCreation}
                className="h-controle w-56 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                value={lieuIdCreation ?? ''}
                onChange={(e) => setLieuIdCreation(e.target.value)}
              >
                {etatLieux.statut === 'pret' &&
                  etatLieux.lieux.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nom}
                    </option>
                  ))}
              </select>
            </label>
            <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="creation-date">
              Date de session
              <input
                id="creation-date"
                type="date"
                className="h-controle w-40 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                value={dateCreation}
                onChange={(e) => setDateCreation(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor="creation-fonds">
              Fonds de caisse initial (€)
              <input
                id="creation-fonds"
                type="text"
                inputMode="decimal"
                className="num h-controle w-32 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                value={fondsCreationSaisie}
                onChange={(e) => setFondsCreationSaisie(e.target.value)}
              />
            </label>
            <label
              className="flex flex-col gap-groupe text-sm text-ink-2"
              htmlFor="creation-evenement"
            >
              Opportunité à l’origine (optionnel)
              <select
                id="creation-evenement"
                className="h-controle w-56 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                value={evenementIdCreation}
                onChange={(e) => setEvenementIdCreation(e.target.value)}
              >
                <option value="">Aucune — session régulière</option>
                {opportunitesDisponibles.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nom} ({formaterDate(o.dateDebut)})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={etatCreation.statut === 'en_cours'}
              className="flex h-controle w-48 items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {etatCreation.statut === 'en_cours' ? 'Création…' : 'Créer et ouvrir'}
            </button>
          </form>
          {etatCreation.statut === 'erreur' && (
            <div className="mt-2">
              <MessageErreur message={etatCreation.message} />
            </div>
          )}
        </Panneau>
      )}

      {/* ═══ Clôture de session ══════════════════════════════════════════ */}
      {sessionEnEditionId !== null && (
        <Panneau
          titre={
            detailEdition !== null ? `Clôture — ${detailEdition.numero}` : 'Clôture de session'
          }
          sansRembourrage
        >
          {etatEdition !== null && etatEdition.statut === 'chargement' && (
            <p className="px-4 py-2 text-sm text-ink-3">Chargement de la session…</p>
          )}
          {etatEdition !== null && etatEdition.statut === 'erreur' && (
            <MessageErreur message={etatEdition.message} />
          )}

          {/*
            En-tête PERSISTANT (défaut réel corrigé le 01/08/2026,
            `Sessions.montage.test.tsx`) : auparavant dupliqué à l'intérieur du
            seul bloc `editionEstOuverte`, ce paragraphe disparaissait donc
            exactement au moment où une clôture réussie faisait passer
            `detailEdition.statut` de `planifiee` à `cloturee` — le même rendu
            qui démonte le bouton « Enregistrer » démontait aussi ce texte.
            Sorti d'ici, hors des deux blocs mutuellement exclusifs ci-dessous,
            il ne dépend plus que de `detailEdition !== null` : il identifie la
            session aussi bien pendant la saisie qu'une fois la clôture
            enregistrée, sans être recréé au passage de l'une à l'autre. */}
          {detailEdition !== null && (
            <p className="border-b border-line px-4 py-2 text-sm font-medium text-ink">
              Session du {formaterDate(detailEdition.dateSession)} — {detailEdition.lieuNom}
            </p>
          )}

          {detailEdition !== null && !editionEstOuverte && (
            <>
              <div className="flex items-center justify-between border-b border-line px-4 py-2">
                <p className="text-sm font-medium text-ink">Clôture enregistrée</p>
                <button
                  ref={boutonFermerClotureRef}
                  type="button"
                  onClick={fermerEdition}
                  className="text-xs font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Fermer
                </button>
              </div>
              {/* Le détail du calcul quand « Produites » vient d'être DÉDUIT
                  d'un volume mesuré — affiché une seule fois, juste après
                  l'enregistrement (§0 : la souplesse vaut pour la clôture,
                  jamais en réécriture d'une pièce comptable déjà figée). */}
              {resolutionVolumeDerniereCloture !== null && (
                <p className="border-b border-line px-4 py-2 text-sm text-ink-2">
                  Volume produit{' '}
                  {formaterQuantite(resolutionVolumeDerniereCloture.volumeProduitMl, 'ml')} −
                  restant {formaterQuantite(resolutionVolumeDerniereCloture.volumeRestantMl, 'ml')}{' '}
                  = consommé{' '}
                  {formaterQuantite(resolutionVolumeDerniereCloture.volumeConsommeMl, 'ml')} →{' '}
                  {detailEdition.crepesProduites} crêpes produites déduites.
                </p>
              )}
              {/* Imputation de la tournée réelle entre la session et les
                  achats (D-064 point 4, Trou 2 — audit du 30/07/2026, refermé
                  le même jour) : désormais PERSISTÉE (migration 0027) et
                  visible aussi dans `BlocDetailSession` ci-dessous
                  (`detail.coutDeplacementReel*Cents`), y compris en rouvrant
                  une session déjà close. Ce bandeau reste un simple rappel
                  affiché juste après l'enregistrement. Masqué quand la
                  distance réelle n'a pas été saisie : les trois valeurs
                  seraient alors des tirets sans rien d'exploitable à
                  montrer. */}
              {imputationDeplacementDerniereCloture !== null &&
                imputationDeplacementDerniereCloture.coutTotalReelCents !== null && (
                  <p className="border-b border-line px-4 py-2 text-sm text-ink-2">
                    Tournée réelle{' '}
                    {formaterEuros(imputationDeplacementDerniereCloture.coutTotalReelCents)} — dont
                    session{' '}
                    {ouTiret(imputationDeplacementDerniereCloture.coutSessionCents, formaterEuros)},
                    détour achats{' '}
                    {ouTiret(
                      imputationDeplacementDerniereCloture.coutDetourAchatsCents,
                      formaterEuros,
                    )}
                    {imputationDeplacementDerniereCloture.coutDetourAchatsCents !== null &&
                    imputationDeplacementDerniereCloture.coutDetourAchatsCents > 0
                      ? ' — à vous de l’enregistrer en dépense (carburant) si ce détour était ' +
                        'un aller chez un fournisseur : jamais ajouté automatiquement.'
                      : '.'}
                  </p>
                )}
              {/* Écart de stock à la vente (D-037) : affiché UNE SEULE FOIS,
                  juste après l'enregistrement — jamais reconstitué en rouvrant
                  la session plus tard (même précaution que les bandeaux
                  ci-dessus). Absent quand le tableau est vide, c'est-à-dire
                  quand le stock enregistré couvrait tout ce qui a été vendu
                  — jamais un bandeau vert affiché à chaque clôture pour le
                  dire (voir `formaterAvertissementEcartsStock` plus haut). */}
              {avertissementEcartsStock !== null && (
                <p className="border-b border-line px-4 py-2 text-sm text-ink-2">
                  <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span> {avertissementEcartsStock}
                </p>
              )}
              {/* Avertissement « marge brute à 100 % sans que rien ne le
                  signale » (audit du 30/07/2026) : affiché UNE SEULE FOIS,
                  juste après l'enregistrement — jamais reconstitué en rouvrant
                  la session plus tard (même précaution que les bandeaux
                  ci-dessus). Absent quand un coût matière transformé a
                  réellement été retenu (même partiel), OU quand la session
                  n'a vendu QUE du revendu — un coût transformé nul y est
                  alors la vérité, pas une anomalie (voir
                  `coutMatiereTransformeSuspect`, `@batte/core`). */}
              {avertissementCoutMatiereTransformeDerniereCloture !== null && (
                <p className="border-b border-line px-4 py-2 text-sm text-ink-2">
                  <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span>{' '}
                  {avertissementCoutMatiereTransformeDerniereCloture}
                </p>
              )}
              {/* Avertissement d'électricité (fiche 17) : affiché UNE SEULE
                  FOIS, juste après l'enregistrement — jamais reconstitué en
                  rouvrant la session plus tard (même précaution que les deux
                  bandeaux ci-dessus). Absent quand le coût retenu est une
                  valeur certaine (mesuré, ou zéro certain — aucune électricité
                  sur ce lieu, ou déjà comptée dans l'emplacement/le forfait). */}
              {avertissementEnergieDerniereCloture !== null && (
                <p className="border-b border-line px-4 py-2 text-sm text-ink-2">
                  <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span>{' '}
                  {avertissementEnergieDerniereCloture}
                </p>
              )}
              {/* Bandeau « clôture sans aucun relevé de température » (mission
                  AFSCA du 30/07/2026) : affiché UNE SEULE FOIS, juste après
                  l'enregistrement — jamais reconstitué en rouvrant la session
                  plus tard (même précaution que les trois bandeaux ci-dessus).
                  Absent dès qu'au moins un relevé (arrivée OU retour) a été
                  saisi — voir `formaterAvertissementReleveTemperatureAbsent`
                  plus haut. Ne bloque jamais rien, ne culpabilise pas et
                  n'affirme rien sur la conformité (CLAUDE.md §7). */}
              {avertissementReleveTemperatureAbsent !== null && (
                <p className="border-b border-line px-4 py-2 text-sm text-ink-2">
                  <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span>{' '}
                  {avertissementReleveTemperatureAbsent}
                </p>
              )}
              <BlocDetailSession detail={detailEdition} />
            </>
          )}

          {detailEdition !== null && editionEstOuverte && (
            <>
              <div className="flex items-center justify-between border-b border-line px-4 py-2">
                <div>
                  <p className="text-xs text-ink-3">
                    {etatCloture === 'en_cours'
                      ? 'Enregistrement…'
                      : estModifie
                        ? 'Modifications non enregistrées'
                        : heureEnregistrement !== null
                          ? `Enregistré ${heureEnregistrement}`
                          : 'Aucune modification'}
                  </p>
                </div>
                <div className="flex items-center gap-groupe">
                  <button
                    ref={boutonEnregistrerClotureRef}
                    type="button"
                    onClick={() => void cloturerSession()}
                    disabled={etatCloture === 'en_cours'}
                    className="flex h-controle items-center justify-center gap-groupe rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {etatCloture === 'en_cours' ? 'Enregistrement…' : 'Enregistrer'}
                    <span className="text-xs opacity-80">Ctrl+S</span>
                  </button>
                  <button
                    type="button"
                    onClick={fermerEdition}
                    className="text-xs font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Fermer
                  </button>
                </div>
              </div>

              {/* Opportunité (fiche 14) : affichée si déjà rattachée, sinon
                  proposée au rattachement — jamais après la clôture (D-059). */}
              <div className="border-b border-line px-4 py-2">
                {detailEdition.evenementId !== null ? (
                  <p className="text-xs text-ink-3">
                    Motivée par l’opportunité «{' '}
                    <span className="text-ink-2">{detailEdition.evenementNom ?? TIRET_ABSENT}</span>{' '}
                    ».
                  </p>
                ) : opportunitesDisponibles.length > 0 ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void rattacherEvenement(detailEdition.id, evenementIdRattachementSaisie);
                    }}
                    className="flex flex-wrap items-end gap-groupe"
                  >
                    <label
                      className="flex flex-col gap-groupe text-xs text-ink-3"
                      htmlFor="rattachement-evenement"
                    >
                      Motivée par une opportunité (optionnel)
                      <select
                        id="rattachement-evenement"
                        className="h-controle w-64 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                        value={evenementIdRattachementSaisie}
                        onChange={(e) => setEvenementIdRattachementSaisie(e.target.value)}
                      >
                        <option value="">Aucune — session régulière</option>
                        {opportunitesDisponibles.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.nom} ({formaterDate(o.dateDebut)})
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="submit"
                      disabled={
                        evenementIdRattachementSaisie === '' ||
                        etatRattachementEvenement.statut === 'en_cours'
                      }
                      className="h-controle rounded-sm border border-line-field px-2 text-xs text-ink-2 hover:bg-surface-sunken disabled:opacity-50"
                    >
                      Rattacher
                    </button>
                    {etatRattachementEvenement.statut === 'erreur' && (
                      <p className="text-xs text-depassement">
                        {etatRattachementEvenement.message}
                      </p>
                    )}
                  </form>
                ) : null}
              </div>

              {erreurCloture !== null &&
                (erreurCloture.nature === 'metier' ? (
                  <div
                    role="alert"
                    className="mx-4 mt-3 border-l-2 border-depassement bg-depassement-bg px-3 py-2 text-sm text-depassement"
                  >
                    {erreurCloture.message}
                  </div>
                ) : (
                  <div className="mx-4 mt-3">
                    <MessageErreur message={erreurCloture.message} />
                  </div>
                ))}

              {/* ─── VENTES ─────────────────────────────────────────────── */}
              <div className="px-4 pt-3">
                <h3 className="text-2xs uppercase text-ink-3">Ventes</h3>
              </div>
              {etatProduits.statut === 'chargement' && (
                <p className="px-4 py-2 text-sm text-ink-3">Chargement du catalogue produits…</p>
              )}
              {etatProduits.statut === 'erreur' && (
                <div className="mx-4">
                  <MessageErreur message={etatProduits.message} />
                </div>
              )}
              {etatProduits.statut === 'pret' &&
                produitsVendables.length === 0 &&
                lignesLibres.length === 0 && (
                  <EtatVide
                    variante="premier-lancement"
                    titre="Aucun produit vendable configuré"
                    explication="Configurez au moins un produit dans l'écran Produits avant de pouvoir saisir une vente."
                    action={{ libelle: 'Aller aux produits', onClick: () => navigate('/produits') }}
                  />
                )}
              {etatProduits.statut === 'pret' &&
                (produitsVendables.length > 0 || lignesLibres.length > 0) && (
                  <table>
                    <colgroup>
                      <col style={{ width: '38%' }} />
                      <col style={{ width: '14%' }} />
                      <col style={{ width: '16%' }} />
                      <col style={{ width: '18%' }} />
                      <col style={{ width: '14%' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">Produit</th>
                        <th scope="col" className="num">
                          Qté
                        </th>
                        <th scope="col" className="num">
                          PU (€)
                        </th>
                        <th scope="col" className="num">
                          Total (€)
                        </th>
                        <th scope="col"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {produitsVendables.map((produit, index) => {
                        const saisie = quantitesCatalogue[produit.id] ?? '';
                        const quantite = parserEntierNonNegatifOuVide(saisie);
                        const total =
                          quantite !== null && quantite > 0
                            ? totalLigne(produit, quantite, produit.prixCents)
                            : 0;
                        return (
                          <tr key={produit.id}>
                            {/* Jamais tronquee. Un produit transforme et son
                              homonyme revendu (ou menu — fiche 16 §2) ne se
                              distinguent que par le suffixe « (revente) » ou
                              « (menu) », donc par la FIN de la chaine —
                              exactement ce que l'ellipse emporte en premier.
                              Le nom complet n'existait que dans
                              l'`aria-label` de l'input voisin, invisible a
                              l'oeil. Or confondre les natures fausse la
                              ventilation transforme / revendu des compteurs de
                              seuils legaux (marge 90 % contre 30 %,
                              CLAUDE.md §6) : c'est une faute comptable, pas un
                              desagrement visuel. Ce tableau n'utilise pas le
                              composant `Tableau`, d'ou l'attribut pose a la
                              main — la regle CSS est la meme. */}
                            <td className="h-rangee-saisie" data-troncature="repli">
                              {produit.nom}
                              {suffixeNatureProduit(produit)}
                            </td>
                            <td className="h-rangee-saisie">
                              <input
                                ref={(el) => {
                                  refsQte.current[index] = el;
                                }}
                                type="text"
                                inputMode="numeric"
                                aria-label={`Quantité vendue — ${produit.nom}`}
                                className={`num h-controle w-full rounded-sm border bg-surface px-2 text-base text-ink ${
                                  quantite === null ? 'border-depassement' : 'border-line-field'
                                }`}
                                value={saisie}
                                onChange={(e) =>
                                  changerQuantiteCatalogue(produit.id, e.target.value)
                                }
                                onKeyDown={(e) => gererEntreeLigne(index, e)}
                              />
                            </td>
                            <td className="h-rangee-saisie num">
                              {formaterMontant(produit.prixCents)}
                            </td>
                            <td className="h-rangee-saisie num">{formaterMontant(total)}</td>
                            <td className="h-rangee-saisie"></td>
                          </tr>
                        );
                      })}

                      {lignesLibres.map((ligne, indexLibre) => {
                        const index = produitsVendables.length + indexLibre;
                        const produit = produitsParId.get(ligne.produitId);
                        const quantite = parserEntierNonNegatifOuVide(ligne.quantiteSaisie);
                        const prixUnitaireCents = parserEuros(ligne.prixUnitaireSaisie);
                        const total =
                          produit !== undefined &&
                          quantite !== null &&
                          quantite > 0 &&
                          prixUnitaireCents !== null
                            ? totalLigne(produit, quantite, prixUnitaireCents)
                            : 0;
                        return (
                          <tr key={ligne.clientId}>
                            <td className="h-rangee-saisie">
                              <select
                                aria-label="Produit (ligne libre)"
                                className="h-controle w-full rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                                value={ligne.produitId}
                                onChange={(e) =>
                                  changerLigneLibreProduit(ligne.clientId, e.target.value)
                                }
                                onKeyDown={(e) => gererEntreeLigne(index, e)}
                              >
                                {produitsVendables.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.nom}
                                    {suffixeNatureProduit(p)}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="h-rangee-saisie">
                              <input
                                ref={(el) => {
                                  refsQte.current[index] = el;
                                }}
                                type="text"
                                inputMode="numeric"
                                aria-label="Quantité (ligne libre)"
                                className={`num h-controle w-full rounded-sm border bg-surface px-2 text-base text-ink ${
                                  quantite === null ? 'border-depassement' : 'border-line-field'
                                }`}
                                value={ligne.quantiteSaisie}
                                onChange={(e) =>
                                  changerLigneLibreQuantite(ligne.clientId, e.target.value)
                                }
                                onKeyDown={(e) => gererEntreeLigne(index, e)}
                              />
                            </td>
                            <td className="h-rangee-saisie">
                              <input
                                type="text"
                                inputMode="decimal"
                                aria-label="Prix unitaire (ligne libre)"
                                className={`num h-controle w-full rounded-sm border bg-surface px-2 text-base text-ink ${
                                  prixUnitaireCents === null
                                    ? 'border-depassement'
                                    : 'border-line-field'
                                }`}
                                value={ligne.prixUnitaireSaisie}
                                onChange={(e) =>
                                  changerLigneLibrePrix(ligne.clientId, e.target.value)
                                }
                                onKeyDown={(e) => gererEntreeLigne(index, e)}
                              />
                            </td>
                            <td className="h-rangee-saisie num">{formaterMontant(total)}</td>
                            <td className="h-rangee-saisie">
                              <button
                                type="button"
                                onClick={() => supprimerLigneLibre(ligne.clientId, index)}
                                className="text-xs font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                              >
                                Supprimer
                              </button>
                            </td>
                          </tr>
                        );
                      })}

                      <tr>
                        <td colSpan={5} className="h-rangee-saisie">
                          <button
                            type="button"
                            onClick={() => ajouterLigneLibre(false)}
                            className="text-sm font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                          >
                            + ligne…
                          </button>
                        </td>
                      </tr>
                      <tr>
                        <td
                          colSpan={3}
                          className="h-rangee-saisie text-right font-medium text-ink-2"
                        >
                          TOTAL
                        </td>
                        <td className="h-rangee-saisie num font-semibold text-ink">
                          {formaterMontant(totauxVentes.caTotalCents)}
                        </td>
                        <td className="h-rangee-saisie"></td>
                      </tr>
                    </tbody>
                  </table>
                )}

              {/* ─── CAISSE ─────────────────────────────────────────────── */}
              <div className="flex flex-col gap-groupe border-t border-line px-4 pt-3">
                <h3 className="text-2xs uppercase text-ink-3">Caisse</h3>
                <div className="flex flex-wrap items-end gap-bloc">
                  <label
                    className="flex flex-col gap-groupe text-sm text-ink-2"
                    htmlFor="session-fonds"
                  >
                    Fonds de caisse (€)
                    <input
                      id="session-fonds"
                      type="text"
                      inputMode="decimal"
                      className="num h-controle w-32 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                      value={fondsCaisseSaisie}
                      onChange={(e) => {
                        setFondsCaisseSaisie(e.target.value);
                        setEstModifie(true);
                      }}
                    />
                  </label>
                  <label
                    className="flex flex-col gap-groupe text-sm text-ink-2"
                    htmlFor="session-especes"
                  >
                    Espèces comptées (€)
                    <input
                      id="session-especes"
                      type="text"
                      inputMode="decimal"
                      className="num h-controle w-32 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                      value={especesCompteesSaisie}
                      onChange={(e) => {
                        setEspecesCompteesSaisie(e.target.value);
                        setEstModifie(true);
                      }}
                    />
                  </label>
                  <label
                    className="flex flex-col gap-groupe text-sm text-ink-2"
                    htmlFor="session-carte"
                  >
                    SumUp — carte (€)
                    <input
                      id="session-carte"
                      type="text"
                      inputMode="decimal"
                      className="num h-controle w-32 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                      value={caCarteSaisie}
                      onChange={(e) => {
                        setCaCarteSaisie(e.target.value);
                        setEstModifie(true);
                      }}
                    />
                  </label>
                  <label
                    className="flex flex-col gap-groupe text-sm text-ink-2"
                    htmlFor="session-tickets"
                  >
                    Tickets (optionnel)
                    <input
                      id="session-tickets"
                      type="text"
                      inputMode="numeric"
                      aria-describedby="session-tickets-aide"
                      className={`num h-controle w-28 rounded-sm border bg-surface px-2 text-base text-ink ${
                        nbTicketsValeur === null ? 'border-depassement' : 'border-line-field'
                      }`}
                      value={nbTicketsSaisie}
                      onChange={(e) => {
                        setNbTicketsSaisie(e.target.value);
                        setEstModifie(true);
                      }}
                    />
                  </label>
                  <p className="flex flex-col gap-groupe text-sm text-ink-2">
                    Écart de caisse
                    <span className="flex h-controle items-center">
                      {resultatCaisse.ecartCaisseCents === null ? (
                        <span className="num text-ink-3">{TIRET_ABSENT}</span>
                      ) : (
                        rendreEcartCaisse(resultatCaisse.ecartCaisseCents)
                      )}
                    </span>
                  </p>
                </div>
                {/* Releve sur le terminal SumUp, pas compte a la main (D-039,
                    docs/17 fiche 11) : seule source du panier moyen, laisse vide
                    il reste `null` — jamais un chiffre calcule sur des articles. */}
                <p id="session-tickets-aide" className="text-xs text-ink-3">
                  Nombre de tickets encaissés, relevé sur le terminal — laissez vide si vous ne
                  l'avez pas compté (le panier moyen restera « — »).
                </p>
              </div>

              {/* ─── PRODUCTION ─────────────────────────────────────────── */}
              <div className="flex flex-col gap-groupe border-t border-line px-4 pt-3">
                <h3 className="text-2xs uppercase text-ink-3">Production</h3>
                {/* Deux façons de déclarer la production, au choix (demande du
                    porteur) — un vrai groupe de boutons radio : les flèches
                    du clavier suffisent à choisir, `Tab` n'y entre qu'une
                    seule fois. */}
                <div
                  role="radiogroup"
                  aria-label="Mode de saisie de la production"
                  className="flex items-center gap-bloc"
                >
                  <label className="flex items-center gap-groupe text-sm text-ink-2">
                    <input
                      type="radio"
                      name="mode-production"
                      checked={modeProduction === 'crepes'}
                      onChange={() => {
                        setModeProduction('crepes');
                        setEstModifie(true);
                      }}
                    />
                    Je compte les crêpes
                  </label>
                  <label className="flex items-center gap-groupe text-sm text-ink-2">
                    <input
                      type="radio"
                      name="mode-production"
                      checked={modeProduction === 'volume'}
                      onChange={() => {
                        setModeProduction('volume');
                        setEstModifie(true);
                      }}
                    />
                    Je compte la pâte restante
                  </label>
                </div>
                <div className="flex flex-wrap items-end gap-bloc">
                  {modeProduction === 'crepes' ? (
                    <label
                      className="flex flex-col gap-groupe text-sm text-ink-2"
                      htmlFor="session-produites"
                    >
                      Produites
                      <input
                        id="session-produites"
                        type="text"
                        inputMode="numeric"
                        className="num h-controle w-24 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                        value={crepesProduitesSaisie}
                        onChange={(e) => {
                          setCrepesProduitesSaisie(e.target.value);
                          setEstModifie(true);
                        }}
                      />
                    </label>
                  ) : (
                    <label
                      className="flex flex-col gap-groupe text-sm text-ink-2"
                      htmlFor="session-volume-restant"
                    >
                      Pâte restante
                      <span className="flex items-center gap-groupe">
                        <input
                          id="session-volume-restant"
                          type="text"
                          inputMode="numeric"
                          className="num h-controle w-24 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                          value={volumeRestantSaisie}
                          onChange={(e) => {
                            setVolumeRestantSaisie(e.target.value);
                            setEstModifie(true);
                          }}
                        />
                        <select
                          aria-label="Unité de la pâte restante"
                          className="h-controle rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                          value={uniteVolumeRestant}
                          onChange={(e) => {
                            setUniteVolumeRestant(e.target.value as 'ml' | 'g');
                            setEstModifie(true);
                          }}
                        >
                          <option value="ml">ml</option>
                          <option value="g">g</option>
                        </select>
                      </span>
                    </label>
                  )}
                  <p className="flex flex-col gap-groupe text-sm text-ink-2">
                    Vendues
                    <span className="num flex h-controle items-center text-ink">
                      {totauxVentes.crepesVendues}
                    </span>
                  </p>
                  <label
                    className="flex flex-col gap-groupe text-sm text-ink-2"
                    htmlFor="session-invendues"
                  >
                    Invendues
                    <input
                      id="session-invendues"
                      type="text"
                      inputMode="numeric"
                      className="num h-controle w-24 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                      value={crepesInvenduesSaisie}
                      onChange={(e) => {
                        setCrepesInvenduesSaisie(e.target.value);
                        setEstModifie(true);
                      }}
                    />
                  </label>
                  <label
                    className="flex flex-col gap-groupe text-sm text-ink-2"
                    htmlFor="session-cassees"
                  >
                    Cassées
                    <input
                      id="session-cassees"
                      type="text"
                      inputMode="numeric"
                      className="num h-controle w-24 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                      value={crepesCasseesSaisie}
                      onChange={(e) => {
                        setCrepesCasseesSaisie(e.target.value);
                        setEstModifie(true);
                      }}
                    />
                  </label>
                  <p className="flex flex-col gap-groupe text-sm text-ink-2">
                    Taux d'écoulement
                    <span className="num flex h-controle items-center text-ink">
                      {ouTiret(tauxEcoulementEnCours, formaterPourcent)}
                    </span>
                  </p>
                </div>
                {modeProduction === 'crepes' && ecartProductionEnCours !== 0 && (
                  <p className="text-sm text-alerte">
                    <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span> Écart de cohérence :
                    produites ≠ vendues + invendues + cassées (
                    {ecartProductionEnCours > 0 ? '+' : ''}
                    {ecartProductionEnCours}).
                  </p>
                )}
                {/* Un volume mesuré n'est JAMAIS une faute : l'écart est une
                    INFORMATION (louche plus généreuse, pâte plus épaisse),
                    jamais un refus de clôturer. */}
                {modeProduction === 'volume' && ecartProductionEnCours !== 0 && (
                  <p className="text-sm text-ink-2">
                    <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span> Écart mesuré : produites
                    ≠ vendues + invendues + cassées ({ecartProductionEnCours > 0 ? '+' : ''}
                    {ecartProductionEnCours}) — une mesure, pas une faute : la clôture n'est pas
                    bloquée.
                  </p>
                )}
                {modeProduction === 'crepes' &&
                  /* Sans production rattachée, le nombre saisi doit être exactement
                     vendues + invendues + cassées (cloture serveur) : le dire ICI
                     evite un refus surprise a l'enregistrement. */
                  (crepesProduitesDeriveesEnCours === null ? (
                    <p className="text-xs text-ink-3">
                      Aucune production rattachée à cette session : « Produites » doit correspondre
                      exactement à vendues + invendues + cassées.
                    </p>
                  ) : (
                    <p className="text-xs text-ink-3">
                      Dérivé de {productionsRattacheesEnCours.length} production
                      {productionsRattacheesEnCours.length > 1 ? 's' : ''} rattachée
                      {productionsRattacheesEnCours.length > 1 ? 's' : ''} :{' '}
                      {crepesProduitesDeriveesEnCours} crêpes. Une valeur différente sera refusée à
                      l'enregistrement.
                    </p>
                  ))}
                {modeProduction === 'volume' &&
                  (apercuVolumeErreur !== null ? (
                    <p className="text-sm text-depassement">
                      <span aria-hidden="true">{GLYPHE_STATUT.depassement}</span>{' '}
                      {apercuVolumeErreur}
                    </p>
                  ) : apercuVolume !== null && !('erreur' in apercuVolume) ? (
                    <p className="text-xs text-ink-3">
                      Volume produit {formaterQuantite(apercuVolume.volumeProduitMl, 'ml')} −
                      restant {formaterQuantite(apercuVolume.volumeRestantMl, 'ml')} = consommé{' '}
                      {formaterQuantite(apercuVolume.volumeConsommeMl, 'ml')} →{' '}
                      {apercuVolume.crepesProduites} crêpes déduites.
                    </p>
                  ) : null)}
              </div>

              {/* ─── FRAIS ───────────────────────────────────────────────── */}
              <div className="flex flex-col gap-groupe border-t border-line px-4 pt-3">
                <h3 className="text-2xs uppercase text-ink-3">Frais</h3>
                <div className="flex flex-wrap items-end gap-bloc">
                  <label
                    className="flex flex-col gap-groupe text-sm text-ink-2"
                    htmlFor="session-frais-emplacement"
                  >
                    Emplacement (€)
                    <input
                      id="session-frais-emplacement"
                      type="text"
                      inputMode="decimal"
                      aria-describedby="session-frais-emplacement-aide"
                      className="num h-controle w-28 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                      value={fraisEmplacementSaisie}
                      onChange={(e) => {
                        setFraisEmplacementSaisie(e.target.value);
                        setEstModifie(true);
                      }}
                    />
                  </label>
                  <ChampJustificatifFrais
                    id="session-frais-emplacement-justificatif"
                    libelle="Ticket emplacement"
                    valeur={justificatifsFraisSaisie.emplacement}
                    erreur={erreursJustificatifsFrais.emplacement}
                    onChange={(e) => surChangementJustificatifFrais('emplacement', e)}
                  />
                  <label
                    className="flex flex-col gap-groupe text-sm text-ink-2"
                    htmlFor="session-frais-deplacement"
                  >
                    Déplacement (€)
                    <input
                      id="session-frais-deplacement"
                      type="text"
                      inputMode="decimal"
                      className="num h-controle w-28 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                      value={fraisDeplacementSaisie}
                      onChange={(e) => {
                        setFraisDeplacementSaisie(e.target.value);
                        setEstModifie(true);
                      }}
                    />
                  </label>
                  <ChampJustificatifFrais
                    id="session-frais-deplacement-justificatif"
                    libelle="Ticket déplacement"
                    valeur={justificatifsFraisSaisie.deplacement}
                    erreur={erreursJustificatifsFrais.deplacement}
                    onChange={(e) => surChangementJustificatifFrais('deplacement', e)}
                  />
                  <label
                    className="flex flex-col gap-groupe text-sm text-ink-2"
                    htmlFor="session-distance-reelle"
                  >
                    Kilomètres réels (km)
                    <input
                      id="session-distance-reelle"
                      type="text"
                      inputMode="decimal"
                      aria-describedby="session-distance-reelle-aide"
                      className={`num h-controle w-28 rounded-sm border bg-surface px-2 text-base text-ink ${
                        distanceReelleValeur === undefined
                          ? 'border-depassement'
                          : 'border-line-field'
                      }`}
                      value={distanceReelleSaisie}
                      onChange={(e) => {
                        setDistanceReelleSaisie(e.target.value);
                        setEstModifie(true);
                      }}
                    />
                  </label>
                  <label
                    className="flex flex-col gap-groupe text-sm text-ink-2"
                    htmlFor="session-frais-gaz"
                  >
                    Gaz (€)
                    <input
                      id="session-frais-gaz"
                      type="text"
                      inputMode="decimal"
                      className="num h-controle w-28 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                      value={fraisGazSaisie}
                      onChange={(e) => {
                        setFraisGazSaisie(e.target.value);
                        setEstModifie(true);
                      }}
                    />
                  </label>
                  <ChampJustificatifFrais
                    id="session-frais-gaz-justificatif"
                    libelle="Ticket gaz"
                    valeur={justificatifsFraisSaisie.gaz}
                    erreur={erreursJustificatifsFrais.gaz}
                    onChange={(e) => surChangementJustificatifFrais('gaz', e)}
                  />
                  <label
                    className="flex flex-col gap-groupe text-sm text-ink-2"
                    htmlFor="session-frais-divers"
                  >
                    Divers (€)
                    <input
                      id="session-frais-divers"
                      type="text"
                      inputMode="decimal"
                      className="num h-controle w-28 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                      value={fraisDiversSaisie}
                      onChange={(e) => {
                        setFraisDiversSaisie(e.target.value);
                        setEstModifie(true);
                      }}
                    />
                  </label>
                  <ChampJustificatifFrais
                    id="session-frais-divers-justificatif"
                    libelle="Ticket divers"
                    valeur={justificatifsFraisSaisie.divers}
                    erreur={erreursJustificatifsFrais.divers}
                    onChange={(e) => surChangementJustificatifFrais('divers', e)}
                  />
                </div>
                {/* Ce que le champ « Emplacement » vide veut dire, et ce qu'il
                    coûte de le laisser tel quel. La phrase est PERMANENTE et
                    non conditionnelle : `session_marche.frais_emplacement_cents`
                    est `NOT NULL DEFAULT 0`, donc la base ne peut PAS
                    distinguer « emplacement gratuit » de « tarif inconnu » une
                    fois la clôture enregistrée — le seul endroit où cette
                    distinction peut encore être faite est ici, avant le clic. */}
                <p id="session-frais-emplacement-aide" className="text-xs text-ink-3">
                  « Emplacement » n’est pré-rempli que si le tarif du lieu est renseigné dans Lieux
                  de marché ; il reste vide sinon. Un frais laissé vide est enregistré à{' '}
                  {/* Passe par le formateur, jamais par un « 0,00 € » écrit à la
                      main : la séparation décimale et l'espace avant le symbole
                      viennent d'`Intl`, et deux écritures divergeraient. */}
                  {formaterEuros(0)} et ne se distinguera plus d’un emplacement réellement gratuit.
                </p>
                {/* Tournée réelle, pas un aller-retour (D-064) : le champ est
                    pré-rempli à 2× la distance de référence du lieu quand elle
                    est connue, mais reste entièrement modifiable pour un
                    détour (autre marché, fournisseur). Laissé vide, jamais 0,
                    quand cette distance de référence est inconnue. */}
                <p id="session-distance-reelle-aide" className="text-xs text-ink-3">
                  Distance réellement parcourue pendant cette tournée (marché, éventuellement un
                  autre marché ou un fournisseur, retour) — pré-remplie à deux fois la distance de
                  référence du lieu, mais librement modifiable en cas de détour. Laissez vide si
                  inconnue.
                </p>
                <p className="text-xs text-ink-3">{MENTION_ATTRIBUTION_DISTANCE}</p>
                {/* Fiche 17 : le coût d'électricité (cas 3 seulement — lieu
                    facturé au compteur) est désormais calculé automatiquement
                    depuis les durées d'équipements ci-dessous, jamais saisi
                    ici. Ne pas le rajouter dans « Divers » : les deux se
                    contrediraient tôt ou tard, et rien ici ne peut détecter un
                    double comptage entre une saisie libre et un calcul. */}
                <p className="text-xs text-ink-3">
                  N'ajoutez pas ici le coût d'électricité : quand ce lieu facture au compteur, il
                  est calculé automatiquement depuis les durées d'équipements ci-dessous — jamais à
                  saisir dans « Divers », sous peine de le compter deux fois.
                </p>
              </div>

              {/* ─── ÉQUIPEMENTS ÉLECTRIQUES (fiche 17, D-055) ─────────────
                  L'électricité dépend du LIEU, pas du projet (CLAUDE.md §6) :
                  un lieu qui n'en fournit AUCUNE ne peut faire tourner aucun
                  appareil électrique — la section reste alors masquée plutôt
                  que de laisser saisir une consommation qui n'a pas de sens.
                  Une disponibilité INCONNUE (lieu pas encore chargé, ou
                  attribut non renseigné) n'est JAMAIS lue comme une absence
                  (D-055, « aucune valeur par défaut optimiste » dans les deux
                  sens) : la section reste alors utilisable. */}
              {electriciteDisponibleLieuEnCours === false ? (
                <p className="border-t border-line px-4 pt-3 text-xs text-ink-3">
                  Ce lieu ne dispose d'aucune électricité (voir l'écran Lieux de marché) : aucun
                  équipement électrique n'est utilisable ici.
                </p>
              ) : (
                <div className="flex flex-col gap-groupe border-t border-line px-4 pt-3">
                  <h3 className="text-2xs uppercase text-ink-3">
                    Équipements électriques (optionnel)
                  </h3>
                  {equipementsDisponibles.length === 0 ? (
                    <p className="text-xs text-ink-3">
                      Aucun équipement électrique déclaré en service — voir l'écran Équipements.
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-end gap-bloc">
                      {equipementsDisponibles.map((equipement) => (
                        <label
                          key={equipement.id}
                          className="flex flex-col gap-groupe text-sm text-ink-2"
                          htmlFor={`session-equipement-${equipement.id}`}
                        >
                          {equipement.nom} — durée (min)
                          <input
                            id={`session-equipement-${equipement.id}`}
                            type="text"
                            inputMode="numeric"
                            placeholder="—"
                            className="num h-controle w-24 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                            value={dureesEquipementsSaisie[equipement.id] ?? ''}
                            onChange={(e) => {
                              const valeur = e.target.value;
                              setDureesEquipementsSaisie((precedent) => ({
                                ...precedent,
                                [equipement.id]: valeur,
                              }));
                              setEstModifie(true);
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-ink-3">
                    Durée d'utilisation pendant cette session, en minutes — laissez vide un appareil
                    non utilisé. Sert au coût d'électricité (lieu facturé au compteur) et au point
                    d'équilibre solaire/éolien (écran Équipements) ; jamais à un calcul de
                    température intérieure.
                  </p>
                  {electriciteDisponibleLieuEnCours === null && (
                    <p className="text-xs text-ink-3">
                      Disponibilité électrique de ce lieu inconnue — ne renseignez aucune durée si
                      vous savez qu'il n'y a pas de courant ici.
                    </p>
                  )}
                </div>
              )}

              {/* ─── TEMPÉRATURES ──────────────────────────────────────────
                  docs/17 fiche 17 : « un registre qu'on remplit ailleurs est
                  un registre qu'on ne remplit pas » (docs/06 §3). Les deux
                  relevés restent OPTIONNELS — un relevé qui manque reste
                  manquant, jamais reconstitué (CLAUDE.md §7). */}
              <div className="flex flex-col gap-groupe border-t border-line px-4 pt-3">
                <h3 className="text-2xs uppercase text-ink-3">Températures</h3>
                <BlocReleveTemperature
                  moment="arrivee"
                  idPrefixe="session-temp-arrivee"
                  saisie={releveArriveeSaisie}
                  onChange={(valeur) => {
                    setReleveArriveeSaisie(valeur);
                    setEstModifie(true);
                  }}
                />
                <BlocReleveTemperature
                  moment="retour"
                  idPrefixe="session-temp-retour"
                  saisie={releveRetourSaisie}
                  onChange={(valeur) => {
                    setReleveRetourSaisie(valeur);
                    setEstModifie(true);
                  }}
                />
                <p className="text-xs text-ink-3">
                  Alimente le registre AFSCA — laissez la température vide si elle n'a pas été
                  prise, elle ne sera jamais reconstituée après coup. Un relevé au-delà du seuil
                  ouvre automatiquement une non-conformité et exige une action corrective.
                </p>
              </div>

              {/* ─── Horaires, notes, exclusion du modèle ───────────────── */}
              <div className="flex flex-col gap-groupe border-t border-line px-4 pt-3 pb-3">
                <div className="flex flex-wrap items-end gap-bloc">
                  <label
                    className="flex flex-col gap-groupe text-sm text-ink-2"
                    htmlFor="session-heure-debut"
                  >
                    Heure de départ
                    <input
                      id="session-heure-debut"
                      type="time"
                      className="h-controle w-32 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                      value={heureDebutSaisie}
                      onChange={(e) => {
                        setHeureDebutSaisie(e.target.value);
                        setEstModifie(true);
                      }}
                    />
                  </label>
                  <label
                    className="flex flex-col gap-groupe text-sm text-ink-2"
                    htmlFor="session-heure-fin"
                  >
                    Heure de retour
                    <input
                      id="session-heure-fin"
                      type="time"
                      className="h-controle w-32 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                      value={heureFinSaisie}
                      onChange={(e) => {
                        setHeureFinSaisie(e.target.value);
                        setEstModifie(true);
                      }}
                    />
                  </label>
                  <label
                    className="flex flex-col gap-groupe text-sm text-ink-2"
                    htmlFor="session-notes"
                  >
                    Notes (optionnel)
                    <input
                      id="session-notes"
                      type="text"
                      className="h-controle w-64 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                      value={notesSaisie}
                      onChange={(e) => {
                        setNotesSaisie(e.target.value);
                        setEstModifie(true);
                      }}
                    />
                  </label>
                </div>
                <label className="flex items-center gap-groupe text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={exclureDuModele}
                    onChange={(e) => {
                      setExclureDuModele(e.target.checked);
                      setEstModifie(true);
                    }}
                  />
                  Exclure cette session du modèle de prévision (donnée aberrante)
                </label>
                {exclureDuModele && (
                  <label
                    className="flex flex-col gap-groupe text-sm text-ink-2"
                    htmlFor="session-motif-exclusion"
                  >
                    Motif de l'exclusion
                    <input
                      id="session-motif-exclusion"
                      type="text"
                      className="h-controle w-full rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                      value={motifExclusionSaisie}
                      onChange={(e) => {
                        setMotifExclusionSaisie(e.target.value);
                        setEstModifie(true);
                      }}
                    />
                  </label>
                )}
              </div>

              {/* ─── Barre d'état — raccourcis clavier ──────────────────── */}
              <div className="flex h-6 items-center border-t border-line px-4 text-xs text-ink-3">
                Tab champ suivant · Entrée ligne suivante · Ctrl+S enregistrer
              </div>
            </>
          )}
        </Panneau>
      )}

      {/* ═══ Liste des sessions ═════════════════════════════════════════ */}
      {etatListe.statut === 'chargement' && (
        <p className="text-sm text-ink-3">Chargement des sessions…</p>
      )}
      {etatListe.statut === 'erreur' && <MessageErreur message={etatListe.message} />}
      {etatListe.statut === 'pret' && (
        <div className="flex flex-col items-start gap-bloc lg:flex-row">
          <div className="min-w-0 flex-1 self-stretch">
            <Panneau titre={compteAccorde(etatListe.total, 'session', 'sessions')} sansRembourrage>
              <Tableau
                colonnes={COLONNES_SESSIONS}
                lignes={etatListe.sessions}
                cleLigne={(s) => s.id}
                {...(sessionEnEditionId !== null
                  ? { ligneSelectionneeCle: sessionEnEditionId }
                  : sessionLectureSeuleId !== null
                    ? { ligneSelectionneeCle: sessionLectureSeuleId }
                    : {})}
                onSelectionnerLigne={selectionnerSession}
                etatVide={
                  <EtatVide
                    variante="premier-lancement"
                    titre="Aucune session enregistrée"
                    explication="Créez votre première session de marché avec le bouton « Nouvelle session »."
                    action={{ libelle: 'Nouvelle session', onClick: ouvrirCreation }}
                  />
                }
              />
            </Panneau>
            {etatListe.sessions.some((s) => s.exclureDuModele) && (
              <p className="mt-1 text-xs text-ink-3">
                * Session exclue du modèle de prévision (donnée aberrante).
              </p>
            )}
          </div>

          {sessionLectureSeuleId !== null && (
            <div className="w-full lg:w-[28.75rem] lg:shrink-0">
              <Panneau titre="Détail de la session" sansRembourrage>
                {etatDetailLectureSeule !== null &&
                  etatDetailLectureSeule.statut === 'chargement' && (
                    <p className="px-4 py-2 text-sm text-ink-3">Chargement…</p>
                  )}
                {etatDetailLectureSeule !== null && etatDetailLectureSeule.statut === 'erreur' && (
                  <div className="px-4 py-2">
                    <MessageErreur message={etatDetailLectureSeule.message} />
                  </div>
                )}
                {etatDetailLectureSeule !== null && etatDetailLectureSeule.statut === 'pret' && (
                  <>
                    <div className="flex items-center justify-end border-b border-line px-4 py-2">
                      <button
                        type="button"
                        ref={boutonFermerLectureSeuleRef}
                        onClick={() => {
                          setSessionLectureSeuleId(null);
                          setEtatDetailLectureSeule(null);
                        }}
                        className="text-xs font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        Fermer
                      </button>
                    </div>

                    {/*
                      Confirmation de l'annulation (défaut réel corrigé le
                      01/08/2026, `Sessions.montage.test.tsx`) : `annulerSession`
                      pose `setEtatAnnulation({ statut: 'succes', … })` ET
                      `setRevelerAnnulation(false)` dans la même passe, et la
                      réponse fait passer `detail.statut` de `cloturee` à
                      `annulee`. Le `<p role="status">` qui portait ce message
                      vivait à la fois DANS le formulaire d'annulation (démonté
                      par `setRevelerAnnulation(false)`) ET dans le bloc
                      `statut === 'cloturee'` (démonté par le nouveau statut) —
                      deux démontages indépendants du même geste. Affiché ici,
                      il ne dépend plus que d'`etatAnnulation`, jamais du statut
                      de la session ni de `revelerAnnulation` : il survit aux
                      deux. L'effet de temporisation à 5 s (plus haut dans ce
                      fichier) referme ce bandeau tout seul, comme prévu à
                      l'origine. */}
                    {etatAnnulation.statut === 'succes' && (
                      <p
                        role="status"
                        className="border-b border-line px-4 py-2 text-sm text-conforme"
                      >
                        {etatAnnulation.message}
                      </p>
                    )}

                    <BlocDetailSession detail={etatDetailLectureSeule.detail} />

                    {/* Rapport de session : ici, sur la session qu'on vient de
                        lire, et non dans un écran d'exports.

                        Ce panneau ne s'ouvre que pour une session `cloturee` ou
                        `annulee` — `selectionnerSession` envoie les deux autres
                        statuts vers le formulaire de clôture. Le second cas est
                        donc le vrai : sur une session ANNULÉE, le bouton reste
                        visible mais inerte, et il dit pourquoi. La route
                        refuserait en 422 avec exactement cette phrase (un
                        rapport de session non clôturée présenterait un chiffre
                        provisoire comme un résultat) ; l'annoncer avant le clic
                        évite de faire découvrir la règle par une erreur. */}
                    <div className="border-t border-line px-4 py-3">
                      <BoutonDocument
                        chemin={`/documents/rapport-session/${etatDetailLectureSeule.detail.id}`}
                        libelle="Éditer le rapport de session (PDF)"
                        libelleAttente="Édition du rapport…"
                        {...(etatDetailLectureSeule.detail.statut === 'cloturee'
                          ? {}
                          : {
                              raisonIndisponible: `Cette session est en statut « ${LIBELLE_STATUT_SESSION[etatDetailLectureSeule.detail.statut]} » : le rapport n’est éditable qu’après clôture.`,
                            })}
                      />
                    </div>

                    <AnalyseEcartClaude
                      sessionId={etatDetailLectureSeule.detail.id}
                      raisonIndisponible={raisonIndisponibleAnalyseEcart(
                        etatDetailLectureSeule.detail.statut,
                      )}
                    />

                    {etatDetailLectureSeule.detail.statut === 'cloturee' && (
                      <div className="border-t border-line px-4 py-3">
                        {!revelerAnnulation ? (
                          <button
                            type="button"
                            onClick={() => setRevelerAnnulation(true)}
                            className="text-sm font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                          >
                            Annuler cette session
                          </button>
                        ) : (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              void annulerSession(etatDetailLectureSeule.detail.id);
                            }}
                            className="flex flex-col gap-groupe"
                          >
                            <label
                              className="flex flex-col gap-groupe text-sm text-ink-2"
                              htmlFor="motif-annulation"
                            >
                              Motif de l'annulation
                              <input
                                id="motif-annulation"
                                ref={champMotifAnnulationSession}
                                type="text"
                                className="h-controle w-full rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                                value={motifAnnulationSaisie}
                                onChange={(e) => setMotifAnnulationSaisie(e.target.value)}
                              />
                            </label>
                            {etatAnnulation.statut === 'erreur' && (
                              <p className="text-sm text-depassement">{etatAnnulation.message}</p>
                            )}
                            {/* Le succès n'est plus rendu ICI : ce formulaire se
                                démonte au moment même où `etatAnnulation` passe
                                à `succes` (voir la confirmation persistante
                                juste au-dessus de `<BlocDetailSession>`). */}
                            <div className="flex items-center gap-groupe">
                              <button
                                type="submit"
                                disabled={etatAnnulation.statut === 'en_cours'}
                                className="flex h-controle w-56 items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {etatAnnulation.statut === 'en_cours'
                                  ? 'Annulation…'
                                  : "Confirmer l'annulation"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setRevelerAnnulation(false)}
                                className="text-sm text-ink-3 hover:text-ink-2"
                              >
                                Annuler
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    )}
                  </>
                )}
              </Panneau>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
