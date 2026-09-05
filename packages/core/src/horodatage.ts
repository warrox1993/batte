/**
 * Dates et heures. CLAUDE.md §8 : stockage en ISO 8601 UTC, affichage local,
 * fuseau `Europe/Brussels` partout. Les sessions de marche sont datees au jour
 * civil belge — ce qui n'est PAS la meme chose que le jour UTC : un marche du
 * dimanche 2 aout commence a 22h00 UTC le samedi 1er en heure d'ete.
 */

export const FUSEAU = 'Europe/Brussels';
const LOCALE = 'fr-BE';

/** Instant courant en ISO 8601 UTC, pret a etre stocke. */
export function maintenantUtc(): string {
  return new Date().toISOString();
}

/**
 * Jour civil belge d'un instant, au format `AAAA-MM-JJ`.
 * Passe par `en-CA` parce que ce locale rend nativement l'ordre annee-mois-jour.
 */
export function jourCivilBelge(instant: Date | string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSEAU,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** « 26/07/2026 ». */
export function formaterDate(instant: Date | string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: FUSEAU,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

/** « 26/07/2026 21:18 ». */
export function formaterDateHeure(instant: Date | string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: FUSEAU,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Ajoute des heures a un instant et rend l'ISO UTC. Sert au calcul de DLC de pate. */
export function ajouterHeures(instant: Date | string, heures: number): string {
  const date = typeof instant === 'string' ? new Date(instant) : new Date(instant.getTime());
  return new Date(date.getTime() + heures * 3_600_000).toISOString();
}

/** Ajoute des jours calendaires a un jour civil `AAAA-MM-JJ`. */
export function ajouterJours(jourCivil: string, jours: number): string {
  const date = new Date(`${jourCivil}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + jours);
  return jourCivil.length === 10 ? date.toISOString().slice(0, 10) : date.toISOString();
}

/**
 * Nombre de jours entiers entre deux jours civils. Positif si `fin` est apres
 * `debut`. Sert aux alertes DLC (« DLC J-3 »).
 */
export function joursEntre(debut: string, fin: string): number {
  const a = Date.parse(`${debut.slice(0, 10)}T12:00:00Z`);
  const b = Date.parse(`${fin.slice(0, 10)}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Date en cellule de tableau : `26/07`, avec l'annee seulement si elle differe
 * de l'annee de reference (docs/07 §4.5). Repeter « /2026 » sur quarante lignes
 * est du bruit ; l'omettre sur une ligne de l'an dernier serait une erreur.
 */
export function formaterDateTableau(instant: Date | string, anneeReference: number): string {
  const complet = formaterDate(instant);
  const annee = Number.parseInt(complet.slice(6), 10);
  return annee === anneeReference ? complet.slice(0, 5) : complet;
}

/**
 * Compteur relatif d'une echeance : `J-3`, `J+2`, `aujourd'hui`.
 *
 * A afficher a cote de la date, jamais a sa place : « DLC 29/07 » informe,
 * « 29/07  J-3 » fait agir. Rend `null` au-dela de `horizonJours`, pour ne pas
 * afficher `J-180` sur un sirop qui perime en 2027.
 *
 * `horizonJours` est OBLIGATOIRE, SANS VALEUR PAR DEFAUT — decision du
 * 01/08/2026 (docs/29-VALEURS-EN-DUR.md §4 et §6 point 2), qui revient sur ce
 * qui etait ecrit ici (`horizonJours = 14`).
 *
 * UNE VALEUR PAR DEFAUT DE PARAMETRE DE FONCTION EST LA FORME LA PLUS
 * TROMPEUSE D'UN SEUIL CODE EN DUR (CLAUDE.md §7) : elle RESSEMBLE a un
 * reglage — un nom, une unite, un chiffre qui a l'air choisi expres — et n'en
 * est pas un, puisque personne ne peut la changer sans recompiler. C'est
 * exactement ce qui s'est produit : `Stock.tsx`, `Production.tsx` et
 * `TableauDeBord.tsx` appelaient cette fonction SANS troisieme argument,
 * retombant tous les trois sur 14 jours, pendant que le brief avant-marche
 * (`GET /prevision/brief`, `apps/api/src/routes/previsions.ts`) repondait a la
 * MEME question (« cette DLC est-elle proche ? ») avec
 * `parametres.entier('brief_horizon_alerte_dlc_jours')` — 7 jours par defaut,
 * mais MODIFIABLE. Un lot a 11 jours de sa DLC etait donc a la fois VISIBLE
 * sur les trois ecrans (11 <= 14) et ABSENT du brief (11 > 7) : deux documents
 * qui se contredisent sur le meme fait, a la meme seconde, sur la meme base.
 *
 * Le defaut n'est PAS conserve « comme filet ». Un filet documente reste un
 * piege pour le prochain appelant qui n'aura pas lu ce commentaire avant
 * d'oublier le troisieme argument — c'est exactement l'erreur qui vient
 * d'etre corrigee. Rendre l'argument obligatoire transforme cet oubli en
 * erreur `tsc` immediate et locale, au lieu d'un ecran qui ment en silence
 * pendant des semaines : le cout d'une erreur de compilation est sans commune
 * mesure avec celui d'un chiffre faux affiche a chaque ouverture de l'ecran.
 * Les quatre appelants (`Stock.tsx`, `Production.tsx`, `TableauDeBord.tsx`,
 * `Comptabilite.tsx`) passent desormais chacun un horizon EXPLICITE, lu depuis
 * un parametre du catalogue plutot qu'invente ici, et l'annoncent a l'ecran.
 */
export function formaterJoursRestants(
  echeance: string,
  aujourdHui: string,
  horizonJours: number,
): string | null {
  const jours = joursEntre(aujourdHui, echeance);
  if (jours > horizonJours) return null;
  if (jours === 0) return "aujourd'hui";
  return jours > 0 ? `J-${jours}` : `J+${Math.abs(jours)}`;
}

/**
 * Horodatage compact pour NOMMER un fichier : `20260726-2318`.
 *
 * EN HEURE BELGE, PAS EN UTC. CLAUDE.md §3 regle 8 dit « stockage en ISO 8601
 * UTC, affichage local » — et un nom de fichier est un affichage. C'est meme le
 * seul que l'operateur lise pour choisir quelle sauvegarde restaurer.
 *
 * Nomme en UTC, ce qui etait ecrit a 19h01 heure belge s'appelait `…-1701`, et
 * surtout une sauvegarde faite a 00h30 portait la DATE DE LA VEILLE. « Prends
 * la sauvegarde d'hier soir » designait alors le mauvais fichier — et sur une
 * base comptable, restaurer la mauvaise sauvegarde est le pire scenario
 * possible. Les fichiers restent tries chronologiquement : le fuseau belge est
 * un decalage constant sur une periode donnee, seul le passage a l'heure d'ete
 * introduit une heure repetee une fois par an, sans consequence a la journee.
 *
 * Le jour vient de `jourCivilBelge`, source unique du jour civil dans ce
 * fichier ; seules l'heure et la minute restent a formater.
 */
export function horodatageFichier(instant: Date = new Date()): string {
  const jour = jourCivilBelge(instant).replaceAll('-', '');
  const heure = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSEAU,
    hour: '2-digit',
    minute: '2-digit',
    // `hourCycle: 'h23'` et non `hour12: false` : ce dernier rend « 24:30 »
    // pour minuit et demi sur certains locales, ce qui casserait le tri.
    hourCycle: 'h23',
  }).format(instant);
  return `${jour}-${heure.replace(':', '')}`;
}

/**
 * Jour civil belge lu dans un nom de fichier horodate (`20260726-2318` →
 * `2026-07-26`), ou `null` si le nom ne suit pas la convention.
 *
 * Sert a purger un dossier de sauvegardes en se fiant au NOM plutot qu'a la
 * date de modification du fichier : une copie, une restauration ou une
 * synchronisation reecrit la `mtime` et rajeunirait artificiellement une
 * sauvegarde ancienne. Le nom, lui, ne ment pas sur la date de la donnee.
 */
export function jourDuNomHorodate(nom: string): string | null {
  const trouve = /(\d{4})(\d{2})(\d{2})-\d{4}/.exec(nom);
  if (trouve === null) return null;
  return `${trouve[1]}-${trouve[2]}-${trouve[3]}`;
}

/**
 * Un jour civil existe-t-il REELLEMENT ?
 *
 * `2026-02-30` respecte le format `AAAA-MM-JJ` et n'existe pas. Les six copies
 * de `champJourCivil` dans `contrats/` ne validaient que la FORME : cette date
 * entrait donc en base sans un mot, et une session, une observation ou une
 * depense s'y rattachait a un jour qui n'a jamais eu lieu.
 *
 * Ce n'est pas un plantage, c'est pire : une donnee fausse et silencieuse. Un
 * releve AFSCA date d'un 30 fevrier ne se defend pas devant un inspecteur.
 *
 * La verification est un aller-retour : on construit la date, on la reformate,
 * et on compare. JavaScript ramene `2026-02-30` au 2 mars — la difference le
 * trahit.
 */
export function estJourCivilValide(jour: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return false;
  const date = new Date(`${jour}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().slice(0, 10) === jour;
}
