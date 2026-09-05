/**
 * Gabarit HTML du registre AFSCA mensuel (Lot 8).
 *
 * Fonction PURE, comme les autres gabarits de `gabarits.ts` : donnees -> HTML,
 * aucun acces base, aucun calcul metier. Les chiffres et libelles arrivent deja
 * resolus par l'appelant.
 *
 * Aucune mention de franchise TVA : ce n'est pas un document commercial. La
 * mention propre a ce document rappelle plutot ce que dit docs/01 module 6 —
 * « l'application ne dispense de rien, elle documente ».
 */

import { documentHtml, echapper, type RenduGabarit } from './rendu.js';
import { formaterDate, formaterDateHeure } from '@batte/core';

const MENTION_REGISTRE_AFSCA =
  "Ce registre reprend les données saisies dans l'application, à leur date de " +
  "saisie réelle. Il documente l'autocontrôle ; il ne remplace ni un contrôle " +
  "AFSCA ni l'appréciation de l'agent chargé de l'inspection.";

/**
 * Repères d'absence PAR CHAMP (audit `docs/31-DOCUMENTS-OUVERTS.md` §5,
 * CLAUDE.md §7 : « une valeur inconnue reste absente, jamais une valeur
 * fabriquée ») — jamais une ligne blanche, qui se lirait comme « pas
 * concerné » plutôt que « pas encore saisi ». Un par champ, INDÉPENDAMMENT :
 * un nom connu sans adresse doit montrer le nom normalement et signaler
 * l'adresse seule, jamais les deux à la fois masqués par un seul repère
 * générique.
 */
const EXPLOITANT_NOM_ABSENT = 'Nom non renseigné — à compléter dans Paramètres';
const EXPLOITANT_ADRESSE_ABSENTE = 'Adresse non renseignée — à compléter dans Paramètres';
const EXPLOITANT_NUMERO_ENTREPRISE_ABSENT =
  "Numéro d'entreprise non renseigné — à compléter dans Paramètres";
const EXPLOITANT_NUMERO_AFSCA_ABSENT =
  "Numéro d'enregistrement AFSCA non renseigné — à compléter dans Paramètres";

const LIBELLES_MOMENT: Record<string, string> = {
  depart: 'Départ',
  arrivee: 'Arrivée',
  mi_session: 'Mi-session',
  retour: 'Retour',
  stockage: 'Stockage',
};

/**
 * Exportée (défaut : privée à ce fichier) : `fiche-rappel.ts` réutilise ces
 * mêmes libellés pour ses propres non-conformités plutôt que d'en tenir une
 * seconde liste qui pourrait diverger — même gravité, même mot sur les deux
 * documents.
 */
export const LIBELLES_GRAVITE: Record<string, string> = {
  mineure: 'Mineure',
  majeure: 'Majeure',
  critique: 'Critique',
};

const LIBELLES_RESULTAT_EXERCICE: Record<string, string> = {
  concluant: 'Concluant',
  ecarts: 'Écarts constatés',
  echec: 'Échec',
};

/**
 * Libellé du statut ACTUEL d'un lot — mêmes quatre valeurs et mêmes libellés
 * que `LIBELLE_STATUT_LOT` sur l'écran de traçabilité (`RegistreAfsca.tsx`) :
 * un même mot doit désigner la même chose à l'écran et sur le document
 * imprimé.
 */
const LIBELLES_STATUT_LOT: Record<'disponible' | 'quarantaine' | 'bloque' | 'detruit', string> = {
  disponible: 'Disponible',
  quarantaine: 'En quarantaine',
  bloque: 'Bloqué',
  detruit: 'Détruit',
};

/**
 * Classe CSS par statut de lot — même sémantique de couleur que
 * `CLASSE_STATUT_LOT` sur l'écran de traçabilité : `quarantaine` est un doute
 * qui attend une décision (alerte), `bloque` une matière déjà retirée de la
 * vente sans décision définitive (dépassement, la couleur la plus grave de ce
 * document). `disponible` et `detruit` restent neutres : le premier est
 * l'état courant sans rien à signaler, le second un état FINAL déjà décidé.
 * `null` = pas de mise en forme particulière.
 */
const CLASSE_STATUT_LOT: Record<
  'disponible' | 'quarantaine' | 'bloque' | 'detruit',
  string | null
> = {
  disponible: null,
  quarantaine: 'statut-alerte',
  bloque: 'statut-depassement',
  detruit: null,
};

export type DonneesRegistreAfscaTemperature = {
  readonly dateReleve: string;
  readonly moment: string;
  readonly equipement: string;
  readonly temperatureC: number;
  readonly conforme: boolean;
  readonly actionCorrective: string | null;
  /**
   * Instant RÉEL d'écriture de ce relevé (`releveTemperature.creeLe`,
   * `packages/db/src/services/afsca.ts`), distinct de `dateReleve` — jour
   * civil MÉTIER de la mesure. CLAUDE.md §7 : « le registre enregistre ce qui
   * a été saisi, avec sa date de saisie réelle. » Transmis par
   * `donneesRegistreAfsca` (`apps/api/src/documents/donnees.ts`). Optionnel
   * uniquement pour tolérer un appelant qui construirait cet objet sans ce
   * champ (voir `registre-afsca.test.ts`) : dans ce cas la colonne Date
   * n'affiche que la date métier, jamais une mention fabriquée.
   */
  readonly creeLe?: string;
  /**
   * Statut de CE relevé — `'active'` (l'immense majorité) ou `'annulee'`
   * (D-083, 31/07/2026 : un relevé MAL SAISI s'annule PAR ÉCRITURE NOUVELLE,
   * jamais par suppression ni par réécriture de sa valeur, CLAUDE.md §3
   * règle 7). Un relevé `annulee` s'imprime BARRÉ, à côté du bon, jamais
   * masqué : « le registre enregistre ce qui a été saisi » (CLAUDE.md §7).
   *
   * REQUIS (pas optionnel comme `creeLe` ci-dessus) : `releveTemperature.statut`
   * est une colonne `NOT NULL` avec valeur par défaut `'active'`, donc TOUJOURS
   * connue de l'appelant réel (`donneesRegistreAfsca`) — l'omettre serait
   * taire une donnée disponible, pas tolérer une lacune légitime.
   */
  readonly statut: 'active' | 'annulee';
  /**
   * Motif de l'annulation (D-083), retrouvé dans `journal_audit` — voir
   * `annulerReleveTemperature` (`packages/db/src/services/afsca.ts`) : ce
   * n'est délibérément PAS une colonne de `releve_temperature`. Optionnel
   * comme `creeLe` : ignoré (aucune mention affichée) sur un relevé `active`,
   * ou si un appelant ne le fournit pas encore.
   *
   * RÉSERVE (D-083) : la question du maintien d'un relevé annulé au registre
   * IMPRIMÉ reste posée à l'AFSCA. Si elle répond non, c'est CETTE section
   * (l'impression) qui changera — filtrer ou non les lignes `annulee` — jamais
   * le modèle : la donnée doit rester en base quoi qu'il arrive.
   */
  readonly motifAnnulation?: string | null;
  /** Instant RÉEL de l'annulation (`journalAudit.dateAction`) — voir `motifAnnulation` ci-dessus. */
  readonly dateAnnulation?: string | null;
};

export type DonneesRegistreAfscaNettoyage = {
  readonly dateExecution: string;
  readonly tacheLibelle: string;
  readonly zone: string;
  readonly executePar: string | null;
  readonly observations: string | null;
  /** Symétrique de `DonneesRegistreAfscaTemperature.creeLe` — voir sa doc. */
  readonly creeLe?: string;
};

/**
 * Session CLÔTURÉE de la période sans aucun relevé de température rattaché
 * (`sessionsSansReleveTemperature`, `packages/db/src/services/afsca.ts`).
 */
export type DonneesRegistreAfscaSessionSansReleve = {
  readonly numero: string;
  readonly dateSession: string;
  readonly lieuNom: string;
};

/**
 * Tâche de nettoyage en retard à la date d'édition (`tachesEnRetard`,
 * `packages/db/src/services/afsca.ts`).
 */
export type DonneesRegistreAfscaTacheEnRetard = {
  readonly libelle: string;
  readonly zone: string;
  readonly derniereExecution: string | null;
  readonly motif: string;
};

/**
 * Lot précis auquel une non-conformité est rattachée — le cas « bloqué suite
 * à rappel fournisseur » ou « ce lot sent mauvais » (`RegistreAfsca.tsx`).
 * `null` quand la non-conformité ne concerne aucun lot en particulier (ex. un
 * relevé de température sur un équipement).
 *
 * Identifiable par numéro OU DLC au jour près, jamais les deux à zéro : c'est
 * la même règle que la fiche 16 (directive 2011/91/UE) — un lot sans le
 * moindre identifiant lisible n'existe pas côté base (avertissement à la
 * saisie). Les DEUX s'affichent quand les deux sont connus (voir
 * `libelleLotConcerne` ci-dessous) : « OU » ne décrit qu'un plancher minimal
 * de traçabilité à la saisie, jamais une règle d'AFFICHAGE qui masquerait une
 * DLC connue au seul motif qu'un numéro existe déjà.
 *
 * DÉFAUT CORRIGÉ (audit du 31/07/2026) : `fournisseurNom` manquait ici et
 * n'avait donc AUCUN mécanisme de repli — `resoudreLotsConcernes`
 * (`apps/api/src/documents/donnees.ts`) ne joignait jamais `schema.fournisseur`,
 * alors que `lot.fournisseurId` existe et que la même jointure fonctionne déjà
 * pour le journal des achats (`donnees.ts`, export Excel). Une non-conformité
 * « rappel fournisseur » imprimée sans le nom du fournisseur oblige à
 * retourner à l'écran Stock pour savoir chez qui rappeler un lot — exactement
 * ce que ce champ sert à éviter (CLAUDE.md §3 règle 6, traçabilité par lot).
 * TOUJOURS connu pour un lot résolu (`lot.fournisseur_id` est `NOT NULL`),
 * jamais optionnel : à la différence du numéro et de la DLC, il n'existe aucun
 * cas où ce champ serait « pas encore saisi ».
 */
export type DonneesRegistreAfscaLotConcerne = {
  readonly ingredientNom: string;
  readonly fournisseurNom: string;
  readonly numeroLotFournisseur: string | null;
  readonly dateDlc: string | null;
  /**
   * Statut ACTUEL du lot (`lot.statut`, colonne `NOT NULL`) — TOUJOURS connu
   * pour un lot résolu, jamais optionnel : à la différence du motif
   * ci-dessous, il n'existe aucun cas où ce champ n'aurait « pas encore été
   * saisi ».
   *
   * NUANCE À NE PAS PERDRE (audit du 30/07/2026) : `motifStatutLibelle` et
   * `dateChangementStatut` ne portent que le motif du DERNIER changement de
   * statut — jamais l'historique complet. Une mise en quarantaine SUIVIE
   * d'une levée affiche donc le motif de la LEVÉE, jamais celui de la
   * quarantaine. Sans ce champ `statut` affiché À CÔTÉ du motif, un lot
   * porterait la mention « Levée de quarantaine » sans qu'on sache, à la
   * seule lecture du registre, s'il est réellement redevenu `disponible` ou
   * s'il a été rebloqué depuis pour une autre raison (`RAPPEL_FOURNISSEUR`
   * peut aussi bien mener à `bloque` qu'à `detruit` — le libellé du motif ne
   * suffit pas à distinguer les deux). C'est exactement la règle déjà
   * appliquée par l'écran de traçabilité (`PastilleStatutLot` dans
   * `RegistreAfsca.tsx`, à côté de `DernierChangementStatutLot`) : le
   * registre imprimé doit faire pareil, jamais afficher le motif seul.
   */
  readonly statut: 'disponible' | 'quarantaine' | 'bloque' | 'detruit';
  /**
   * Motif et date du DERNIER changement de statut de ce lot
   * (`lot.motif_statut_id`, `lot.date_changement_statut`, écrits par
   * `changerStatutLot`, `packages/db/src/services/mouvements.ts`) — la trace
   * exacte qu'un contrôle AFSCA vient chercher sur un lot rattaché à une
   * non-conformité : pourquoi ce lot a-t-il été mis en quarantaine/bloqué, et
   * quand. Même paire que `TracabiliteAvalLot.motifStatutLibelle` /
   * `.dateChangementStatut` (`packages/db/src/depots/tracabilite.ts`).
   *
   * Transmis par `resoudreLotsConcernes`
   * (`apps/api/src/documents/donnees.ts`). Optionnels, et volontairement
   * DISTINCTS d'une valeur `null` isolée, uniquement pour tolérer un appelant
   * qui construirait cet objet sans ces deux champs (voir
   * `registre-afsca.test.ts`) : dans ce cas la ligne n'affiche aucune mention
   * de changement de statut — jamais un motif fabriqué. `null` reste possible
   * et légitime une fois transmis : un lot qui n'a JAMAIS changé de statut
   * depuis sa réception (cas courant) n'a aucun motif à afficher (CLAUDE.md
   * §7).
   */
  readonly motifStatutLibelle?: string | null;
  readonly dateChangementStatut?: string | null;
};

export type DonneesRegistreAfscaNonConformite = {
  readonly dateConstat: string;
  readonly type: string;
  readonly description: string;
  readonly gravite: string;
  readonly actionCorrective: string | null;
  readonly dateResolution: string | null;
  readonly lot: DonneesRegistreAfscaLotConcerne | null;
};

export type DonneesRegistreAfscaExercice = {
  readonly dateExercice: string;
  readonly dureeMinutes: number | null;
  readonly resultat: string;
  readonly ecartsConstates: string | null;
};

/**
 * Identité de l'exploitant contrôlé — nom, adresse, numéro d'entreprise (BCE)
 * et numéro d'enregistrement AFSCA, lus depuis les paramètres `exploitant_*`
 * (`packages/core/src/parametres.ts`) par `donneesRegistreAfsca`
 * (`apps/api/src/documents/donnees.ts`).
 *
 * AUCUN registre présenté à un contrôle ne peut identifier son exploitant
 * sans ces quatre champs (audit `docs/31-DOCUMENTS-OUVERTS.md` §5 : « aucune
 * notion d'exploitant n'existait nulle part dans le dépôt »).
 *
 * Chaque champ est INDÉPENDAMMENT `string | null` : `null` tant qu'il n'a pas
 * été saisi dans l'écran Paramètres — JAMAIS une valeur fabriquée (CLAUDE.md
 * §7). Le gabarit doit alors imprimer un repère visuellement distinct PAR
 * CHAMP (constantes `EXPLOITANT_*_ABSENT` ci-dessus), jamais une ligne
 * blanche qui se lirait comme « pas concerné ».
 */
export type DonneesRegistreAfscaExploitant = {
  readonly nom: string | null;
  readonly adresse: string | null;
  readonly numeroEntreprise: string | null;
  readonly numeroEnregistrementAfsca: string | null;
};

export type DonneesRegistreAfsca = {
  /** « Juillet 2026 », déjà formaté par l'appelant. */
  readonly periodeLibelle: string;
  readonly dateGeneration: Date;
  /**
   * Identité de l'exploitant — voir `DonneesRegistreAfscaExploitant`.
   * TOUJOURS présent (jamais optionnel comme `sessionsSansReleveTemperature`
   * ci-dessous) : `donneesRegistreAfsca` lit systématiquement les quatre
   * paramètres `exploitant_*`, même quand ils sont tous encore vides — un
   * registre sans cette lecture n'existe pas, à la différence d'une
   * vérification facultative comme les tâches de nettoyage en retard.
   *
   * Imprimé À LA FOIS dans `entete()` (bloc complet, page 1 uniquement) ET
   * dans `pied()` (forme compacte, RÉPÉTÉE sur chaque page par Chromium) :
   * un registre se présente feuille par feuille, une identité posée
   * seulement en en-tête disparaîtrait dès la page 2 (voir le commentaire de
   * `pied()` plus bas).
   */
  readonly exploitant: DonneesRegistreAfscaExploitant;
  readonly temperatures: readonly DonneesRegistreAfscaTemperature[];
  readonly nettoyages: readonly DonneesRegistreAfscaNettoyage[];
  readonly nonConformites: readonly DonneesRegistreAfscaNonConformite[];
  readonly exercicesTracabilite: readonly DonneesRegistreAfscaExercice[];
  /**
   * Sessions clôturées de la période sans aucun relevé de température.
   *
   * **Optionnel, et volontairement DISTINCT d'un tableau vide.** `undefined`
   * signifie « cette vérification n'a pas été faite » — le gabarit reste
   * alors SILENCIEUX sur ce point, jamais ne prétend « rien à signaler »
   * pour une question qu'il n'a pas posée. Un tableau vide `[]` signifie
   * « vérifié, aucun trou trouvé ». CLAUDE.md §7 : « un registre qui affiche
   * seulement ce qui existe donne une fausse impression de complétude » —
   * mentir par un faux « tout va bien » serait pire que de se taire.
   *
   * Renseigné (toujours un tableau, jamais `undefined`) par
   * `donneesRegistreAfsca` (`apps/api/src/documents/donnees.ts`) — voir
   * `audit-documents.test.ts` pour la preuve sur la chaîne réelle.
   */
  readonly sessionsSansReleveTemperature?: readonly DonneesRegistreAfscaSessionSansReleve[];
  /**
   * Tâches de nettoyage en retard à la date d'édition du registre. Même
   * convention `undefined` / `[]` que `sessionsSansReleveTemperature`
   * ci-dessus, et renseigné de la même façon.
   */
  readonly tachesNettoyageEnRetard?: readonly DonneesRegistreAfscaTacheEnRetard[];
};

/**
 * Un champ d'identité d'exploitant : la valeur si connue, sinon un repère
 * visuellement distinct (`.statut-alerte`, orange, jamais la couleur seule —
 * voir `style-impression.ts`) — jamais une ligne blanche, qui se lirait comme
 * « pas concerné » plutôt que « pas encore saisi » (CLAUDE.md §7).
 * `messageAbsence` est un texte STATIQUE écrit dans ce fichier (une des
 * constantes `EXPLOITANT_*_ABSENT` ci-dessus) : il n'a pas besoin d'être
 * échappé, seule `valeur` (une donnée saisie par l'utilisateur) l'est.
 */
export function champExploitant(valeur: string | null, messageAbsence: string): string {
  return valeur === null
    ? `<span class="statut-alerte">${messageAbsence}</span>`
    : echapper(valeur);
}

/**
 * Bloc COMPLET de l'identité de l'exploitant — imprimé une fois, dans
 * `entete()`, donc visible seulement en page 1 (voir le commentaire de
 * `pied()` ci-dessous pour la forme compacte qui, elle, se répète).
 */
export function blocExploitant(exploitant: DonneesRegistreAfscaExploitant): string {
  return `<div style="margin:2mm 0 6mm;font-size:8.5pt;color:#3f3f46">
    <strong>${champExploitant(exploitant.nom, EXPLOITANT_NOM_ABSENT)}</strong><br />
    ${champExploitant(exploitant.adresse, EXPLOITANT_ADRESSE_ABSENTE)}<br />
    N° d'entreprise : ${champExploitant(exploitant.numeroEntreprise, EXPLOITANT_NUMERO_ENTREPRISE_ABSENT)}
    · N° d'enregistrement AFSCA :
    ${champExploitant(exploitant.numeroEnregistrementAfsca, EXPLOITANT_NUMERO_AFSCA_ABSENT)}
  </div>`;
}

/**
 * Forme COMPACTE de l'identité (nom + numéro d'entreprise seulement), pour
 * le pied de page — voir le commentaire de `pied()` ci-dessous sur pourquoi
 * c'est ELLE, et non le bloc complet d'`entete()`, qui doit survivre à la
 * page 2.
 */
export function exploitantCompact(exploitant: DonneesRegistreAfscaExploitant): string {
  const nom = champExploitant(exploitant.nom, 'nom non renseigné');
  const numeroEntreprise = champExploitant(
    exploitant.numeroEntreprise,
    "n° d'entreprise non renseigné",
  );
  return `${nom} — ${numeroEntreprise}`;
}

function entete(
  periodeLibelle: string,
  dateGeneration: Date,
  exploitant: DonneesRegistreAfscaExploitant,
): string {
  return `<div class="entete">
    <div>
      <h1>Registre d'autocontrôle AFSCA</h1>
      <p class="sous-titre">${echapper(periodeLibelle)}</p>
    </div>
    <div class="reference">
      <strong>Édité le</strong>${echapper(formaterDate(dateGeneration))}
    </div>
  </div>
  ${blocExploitant(exploitant)}`;
}

/**
 * DÉFAUT CORRIGÉ (audit `docs/31-DOCUMENTS-OUVERTS.md` §4 et §5) : `rendrePdf`
 * (`rendu.ts`) ne répète QUE `footerTemplate` sur chaque page — `headerTemplate`
 * reste vide et `entete()` n'est que du contenu de CORPS, donc mécaniquement
 * limité à la première page. Une identité d'exploitant posée UNIQUEMENT dans
 * `entete()` disparaîtrait donc dès la page 2, et un registre se présente
 * feuille par feuille (contrôle AFSCA compris). C'est pour cela que
 * `exploitantCompact` ci-dessus est imprimée ICI, dans `pied()` : c'est le
 * SEUL mécanisme de ce document qui se répète réellement sur chaque page
 * (vérifié : `docs/31` §2 confirme déjà que le pied de page — titre + numéro
 * de page — s'affiche sur les 3 pages du registre de juillet).
 *
 * La mention légale (`MENTION_REGISTRE_AFSCA`) souffrait du MÊME défaut —
 * l'audit l'a signalé explicitement (§5 : « n'apparaît qu'une seule fois, sur
 * la dernière page ») : posée comme dernier paragraphe du corps, une seule
 * page sur plusieurs la porterait. Elle reste ICI AUSSI dans le corps (pour
 * un lecteur qui lit la dernière page en entier, en plus grand que 6,5 pt) et
 * est maintenant DUPLIQUÉE ici en forme compacte, pour que CHAQUE page,
 * pas seulement la dernière, porte la mention réglementaire — même logique de
 * duplication entete/pied que le titre et la période, déjà répétés des deux
 * côtés avant ce correctif.
 */
function pied(periodeLibelle: string, exploitant: DonneesRegistreAfscaExploitant): string {
  return `<div style="width:100%;font-size:7pt;color:#71717a;padding:0 15mm;font-family:'Segoe UI',sans-serif">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:4mm">
      <span>${echapper(`Registre AFSCA — ${periodeLibelle}`)} · ${exploitantCompact(exploitant)}</span>
      <span style="white-space:nowrap">page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>
    <div style="margin-top:0.5mm;font-size:6.5pt">${echapper(MENTION_REGISTRE_AFSCA)}</div>
  </div>`;
}

/**
 * Mention « Saisi le JJ/MM/AAAA », affichée SEULEMENT quand le jour civil de
 * l'écriture réelle (`creeLe`) diffère du jour civil MÉTIER de l'événement.
 *
 * CLAUDE.md §7 : « le registre enregistre ce qui a été saisi, avec sa date de
 * saisie réelle [...]. Si la date de l'événement et la date de saisie
 * diffèrent, les deux doivent apparaître. » Rendre cette mention identique et
 * silencieuse quand les deux jours coïncident (la très large majorité des cas
 * : une saisie faite le jour même) évite de noyer le registre d'une mention
 * inutile sur chaque ligne — elle ne doit attirer l'œil que sur un ÉCART.
 */
function mentionSaisieDifferee(dateMetier: string, creeLe: string | undefined): string {
  if (creeLe === undefined) return '';
  const jourSaisie = creeLe.slice(0, 10);
  if (jourSaisie === dateMetier) return '';
  return `<br /><span class="statut-alerte">Saisi le ${echapper(formaterDate(jourSaisie))}</span>`;
}

/**
 * Mention « Relevé annulé (le JJ/MM/AAAA HH:MM) : {motif} », affichée
 * SEULEMENT sur un relevé `statut === 'annulee'` (D-083). Même forme que
 * `mentionChangementStatutLot` plus bas dans ce fichier : le motif ne se lit
 * jamais seul, toujours à côté du fait qu'il explique.
 *
 * `style="text-decoration:none"` ANNULE volontairement le barré posé sur la
 * ligne entière (voir `sectionTemperatures` ci-dessous) : la ligne barrée dit
 * « ceci ne fait plus foi », mais CETTE mention est la correction ELLE-MÊME —
 * elle doit se lire normalement, pas comme si elle aussi était périmée.
 */
function mentionAnnulationReleve(t: DonneesRegistreAfscaTemperature): string {
  if (t.statut !== 'annulee') return '';
  const date =
    t.dateAnnulation === undefined || t.dateAnnulation === null
      ? ''
      : ` (le ${echapper(formaterDateHeure(t.dateAnnulation))})`;
  const motif =
    t.motifAnnulation === undefined || t.motifAnnulation === null
      ? ''
      : ` : ${echapper(t.motifAnnulation)}`;
  return (
    `<br /><span class="statut-alerte" style="text-decoration:none">` +
    `Relevé annulé${date}${motif}</span>`
  );
}

function sectionTemperatures(lignes: readonly DonneesRegistreAfscaTemperature[]): string {
  if (lignes.length === 0) {
    return `<h2>Relevés de température</h2><p class="absent">Aucun relevé sur la période.</p>`;
  }

  return `
    <h2>Relevés de température</h2>
    <table>
      <colgroup>
        <col style="width:14%">
        <col style="width:10%">
        <col style="width:16%">
        <col style="width:10%">
        <col style="width:12%">
        <col style="width:38%">
      </colgroup>
      <thead>
        <tr>
          <th>Date</th>
          <th>Moment</th>
          <th>Équipement</th>
          <th class="num">Temp. (°C)</th>
          <th>Statut</th>
          <th>Action corrective</th>
        </tr>
      </thead>
      <tbody>
        ${lignes
          .map((l) => {
            // Relevé ANNULÉ (D-083) : la ligne s'imprime BARRÉE, à côté du bon
            // relevé qui la corrige, jamais masquée — CLAUDE.md §7, « le
            // registre enregistre ce qui a été saisi ». `text-decoration` posé
            // sur la ligne se propage visuellement à tout son contenu textuel
            // (comportement standard CSS) ; `mentionAnnulationReleve`
            // ci-dessus l'annule explicitement sur SA propre mention, qui n'est
            // pas périmée, elle.
            const ligneBarree =
              l.statut === 'annulee' ? ' style="text-decoration:line-through"' : '';
            return `<tr${ligneBarree}>
              <td>${echapper(formaterDate(l.dateReleve))}${mentionSaisieDifferee(l.dateReleve, l.creeLe)}${mentionAnnulationReleve(l)}</td>
              <td>${echapper(LIBELLES_MOMENT[l.moment] ?? l.moment)}</td>
              <td>${echapper(l.equipement)}</td>
              <td class="num">${l.temperatureC.toLocaleString('fr-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
              <td>${
                l.conforme ? 'Conforme' : `<span class="statut-depassement">Dépassement</span>`
              }</td>
              <td>${
                l.actionCorrective === null
                  ? `<span class="absent">—</span>`
                  : echapper(l.actionCorrective)
              }</td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>
  `;
}

/**
 * Sessions clôturées sans relevé de température. Rend une chaîne VIDE (aucune
 * section, ni titre ni tableau) quand `lignes` est `undefined` — cette
 * vérification n'a alors pas été faite, et prétendre « rien à signaler »
 * serait un mensonge par omission sur un document réglementaire. Voir la doc
 * de `DonneesRegistreAfsca.sessionsSansReleveTemperature`.
 */
function sectionSessionsSansReleve(
  lignes: readonly DonneesRegistreAfscaSessionSansReleve[] | undefined,
): string {
  if (lignes === undefined) return '';
  if (lignes.length === 0) {
    return (
      `<h2>Sessions sans relevé de température</h2>` +
      `<p class="absent">Aucune session clôturée sans relevé sur la période.</p>`
    );
  }

  return `
    <h2>Sessions sans relevé de température</h2>
    <table>
      <colgroup>
        <col style="width:25%">
        <col style="width:20%">
        <col style="width:55%">
      </colgroup>
      <thead>
        <tr>
          <th>Session</th>
          <th>Date</th>
          <th>Lieu</th>
        </tr>
      </thead>
      <tbody>
        ${lignes
          .map(
            (l) => `<tr>
              <td>${echapper(l.numero)}</td>
              <td>${echapper(formaterDate(l.dateSession))}</td>
              <td>${echapper(l.lieuNom)}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

/** Symétrique de `sectionSessionsSansReleve` — voir sa doc pour la convention `undefined` / `[]`. */
function sectionTachesEnRetard(
  lignes: readonly DonneesRegistreAfscaTacheEnRetard[] | undefined,
): string {
  if (lignes === undefined) return '';
  if (lignes.length === 0) {
    return (
      `<h2>Tâches de nettoyage en retard</h2>` +
      `<p class="absent">Aucune tâche en retard à la date d'édition du registre.</p>`
    );
  }

  return `
    <h2>Tâches de nettoyage en retard</h2>
    <table>
      <colgroup>
        <col style="width:28%">
        <col style="width:18%">
        <col style="width:16%">
        <col style="width:38%">
      </colgroup>
      <thead>
        <tr>
          <th>Tâche</th>
          <th>Zone</th>
          <th>Dernière exécution</th>
          <th>Motif</th>
        </tr>
      </thead>
      <tbody>
        ${lignes
          .map(
            (l) => `<tr>
              <td>${echapper(l.libelle)}</td>
              <td>${echapper(l.zone)}</td>
              <td>${
                l.derniereExecution === null
                  ? `<span class="absent">—</span>`
                  : echapper(formaterDate(l.derniereExecution))
              }</td>
              <td>${echapper(l.motif)}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function sectionNettoyage(lignes: readonly DonneesRegistreAfscaNettoyage[]): string {
  if (lignes.length === 0) {
    return `<h2>Plan de nettoyage</h2><p class="absent">Aucune exécution enregistrée sur la période.</p>`;
  }

  return `
    <h2>Plan de nettoyage</h2>
    <table>
      <colgroup>
        <col style="width:12%">
        <col style="width:22%">
        <col style="width:14%">
        <col style="width:18%">
        <col style="width:34%">
      </colgroup>
      <thead>
        <tr>
          <th>Date</th>
          <th>Tâche</th>
          <th>Zone</th>
          <th>Exécuté par</th>
          <th>Observations</th>
        </tr>
      </thead>
      <tbody>
        ${lignes
          .map(
            (l) => `<tr>
              <td>${echapper(formaterDate(l.dateExecution))}${mentionSaisieDifferee(l.dateExecution, l.creeLe)}</td>
              <td>${echapper(l.tacheLibelle)}</td>
              <td>${echapper(l.zone)}</td>
              <td>${l.executePar === null ? `<span class="absent">—</span>` : echapper(l.executePar)}</td>
              <td>${l.observations === null ? `<span class="absent">—</span>` : echapper(l.observations)}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

/**
 * Libellé du lot concerné par une non-conformité — c'est précisément le champ
 * qui borne la PORTÉE d'un rappel (CLAUDE.md §3 règle 6, traçabilité par
 * lot). Les quatre informations qui la déterminent s'affichent TOUJOURS
 * ensemble quand elles sont connues : fournisseur, numéro, DLC, statut.
 *
 * DÉFAUT CORRIGÉ (audit du 31/07/2026) : le numéro et la DLC se combinaient en
 * OU (`??`), donc une DLC pourtant connue disparaissait dès qu'un numéro
 * existait — exactement l'inverse de ce que demande un rappel, où on veut
 * SAVOIR jusqu'à quand ce lot précis pouvait circuler. Le fournisseur, lui,
 * n'avait aucun mécanisme de repli : il n'apparaissait jamais. Les deux
 * s'affichent maintenant chacun quand ils sont connus, jamais fabriqués l'un
 * pour l'autre (CLAUDE.md §7 : une valeur inconnue reste absente).
 */
export function libelleLotConcerne(lot: DonneesRegistreAfscaLotConcerne): string {
  const identifiants = [
    lot.numeroLotFournisseur,
    lot.dateDlc === null ? null : `DLC ${formaterDate(lot.dateDlc)}`,
  ]
    .filter((valeur): valeur is string => valeur !== null)
    .map((valeur) => echapper(valeur))
    .join(' — ');

  const base = `${echapper(lot.ingredientNom)} — ${echapper(lot.fournisseurNom)}${
    identifiants === '' ? '' : ` — ${identifiants}`
  }`;
  return `${base}${mentionStatutLot(lot)}`;
}

/**
 * Statut ACTUEL du lot, TOUJOURS affiché — voir la doc de
 * `DonneesRegistreAfscaLotConcerne.statut` pour la nuance qu'il porte : les
 * deux champs `motifStatutLibelle`/`dateChangementStatut` ne disent que le
 * DERNIER changement, jamais l'état réellement en vigueur aujourd'hui. Ce
 * statut se lit donc à côté du motif, jamais à sa place ni masqué par lui.
 *
 * Colorée seulement pour `quarantaine` (alerte) et `bloque` (dépassement) —
 * mêmes couleurs que `PastilleStatutLot` sur l'écran de traçabilité — jamais
 * pour `disponible`/`detruit`, deux états sans rien qui appelle une décision.
 */
function mentionStatutLot(lot: DonneesRegistreAfscaLotConcerne): string {
  const libelle = LIBELLES_STATUT_LOT[lot.statut];
  const classe = CLASSE_STATUT_LOT[lot.statut];
  const statutHtml =
    classe === null ? echapper(libelle) : `<span class="${classe}">${echapper(libelle)}</span>`;
  return `<br />Statut : ${statutHtml}${mentionChangementStatutLot(lot)}`;
}

/**
 * Mention « — Dernier changement de statut : {motif} (le JJ/MM/AAAA HH:MM) »,
 * affichée SEULEMENT quand `motifStatutLibelle` vaut une CHAÎNE (jamais
 * `undefined` ni `null`) — voir la doc de `DonneesRegistreAfscaLotConcerne`
 * pour la convention à trois états. Toujours accolée à `mentionStatutLot`
 * ci-dessus : le motif du DERNIER changement ne se lit jamais seul, toujours
 * à côté du statut réellement en vigueur aujourd'hui (nuance de l'audit du
 * 30/07/2026 — une levée de quarantaine affiche le motif de la LEVÉE, jamais
 * celui de la mise en quarantaine qui l'a précédée).
 */
function mentionChangementStatutLot(lot: DonneesRegistreAfscaLotConcerne): string {
  if (lot.motifStatutLibelle === undefined || lot.motifStatutLibelle === null) return '';
  const date =
    lot.dateChangementStatut !== undefined && lot.dateChangementStatut !== null
      ? ` (le ${echapper(formaterDateHeure(lot.dateChangementStatut))})`
      : '';
  return ` — <span class="statut-alerte">Dernier changement de statut : ${echapper(lot.motifStatutLibelle)}${date}</span>`;
}

/**
 * LA table la plus à risque de tout le produit (audit du 31/07/2026, docs/24
 * §2.1) : Type, Description ET Action corrective sont TROIS colonnes de texte
 * libre sans limite de longueur à la saisie (schemaCreationNonConformite,
 * packages/core/src/contrats/afsca.ts). `table-layout: fixed`
 * (style-impression.ts) + le `<colgroup>` ci-dessous bornent chaque colonne
 * indépendamment de son contenu : un champ long et sans espace s'enroule
 * désormais dans sa cellule au lieu de pousser les colonnes suivantes hors de
 * la page imprimable — voir `table-impression-largeur.test.ts`.
 */
function sectionNonConformites(lignes: readonly DonneesRegistreAfscaNonConformite[]): string {
  if (lignes.length === 0) {
    return `<h2>Non-conformités</h2><p class="absent">Aucune non-conformité constatée sur la période.</p>`;
  }

  return `
    <h2>Non-conformités</h2>
    <table>
      <colgroup>
        <col style="width:9%">
        <col style="width:14%">
        <col style="width:23%">
        <col style="width:10%">
        <col style="width:16%">
        <col style="width:16%">
        <col style="width:12%">
      </colgroup>
      <thead>
        <tr>
          <th>Constat</th>
          <th>Type</th>
          <th>Description</th>
          <th>Gravité</th>
          <th>Lot concerné</th>
          <th>Action corrective</th>
          <th>Résolution</th>
        </tr>
      </thead>
      <tbody>
        ${lignes
          .map(
            (l) => `<tr>
              <td>${echapper(formaterDate(l.dateConstat))}</td>
              <td>${echapper(l.type)}</td>
              <td>${echapper(l.description)}</td>
              <td>${echapper(LIBELLES_GRAVITE[l.gravite] ?? l.gravite)}</td>
              <td>${l.lot === null ? `<span class="absent">—</span>` : libelleLotConcerne(l.lot)}</td>
              <td>${
                l.actionCorrective === null
                  ? `<span class="absent">—</span>`
                  : echapper(l.actionCorrective)
              }</td>
              <td>${
                l.dateResolution === null
                  ? `<span class="statut-alerte">En cours</span>`
                  : echapper(formaterDate(l.dateResolution))
              }</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function sectionExercicesTracabilite(lignes: readonly DonneesRegistreAfscaExercice[]): string {
  if (lignes.length === 0) {
    return `<h2>Exercice de traçabilité</h2><p class="absent">Aucun exercice réalisé sur la période.</p>`;
  }

  return `
    <h2>Exercice de traçabilité</h2>
    <table>
      <colgroup>
        <col style="width:15%">
        <col style="width:15%">
        <col style="width:20%">
        <col style="width:50%">
      </colgroup>
      <thead>
        <tr>
          <th>Date</th>
          <th class="num">Durée (min)</th>
          <th>Résultat</th>
          <th>Écarts constatés</th>
        </tr>
      </thead>
      <tbody>
        ${lignes
          .map(
            (l) => `<tr>
              <td>${echapper(formaterDate(l.dateExercice))}</td>
              <td class="num">${l.dureeMinutes === null ? `<span class="absent">—</span>` : String(l.dureeMinutes)}</td>
              <td>${echapper(LIBELLES_RESULTAT_EXERCICE[l.resultat] ?? l.resultat)}</td>
              <td>${
                l.ecartsConstates === null
                  ? `<span class="absent">—</span>`
                  : echapper(l.ecartsConstates)
              }</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `;
}

export function registreAfscaMensuel(donnees: DonneesRegistreAfsca): RenduGabarit {
  const corps = `
    ${entete(donnees.periodeLibelle, donnees.dateGeneration, donnees.exploitant)}

    ${sectionTemperatures(donnees.temperatures)}
    ${sectionSessionsSansReleve(donnees.sessionsSansReleveTemperature)}
    ${sectionNettoyage(donnees.nettoyages)}
    ${sectionTachesEnRetard(donnees.tachesNettoyageEnRetard)}
    ${sectionNonConformites(donnees.nonConformites)}
    ${sectionExercicesTracabilite(donnees.exercicesTracabilite)}

    <p class="mention">${echapper(MENTION_REGISTRE_AFSCA)}</p>
  `;

  return documentHtml(`Registre AFSCA — ${donnees.periodeLibelle}`, corps, {
    pied: pied(donnees.periodeLibelle, donnees.exploitant),
  });
}
