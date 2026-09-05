/**
 * Énergie et puissance électriques du stand (docs/demandes/17-ENERGIE-GAZ-
 * ELECTRICITE-SOLAIRE-EMPREINTE.md, D-055).
 *
 * ## Le point central : puissance et énergie ne sont PAS la même chose
 *
 * - L'ÉNERGIE (puissance × durée) détermine ce qu'on PAIE. Elle s'additionne
 *   DANS LE TEMPS : trois radiateurs de 1 500 W allumés une heure chacun, à
 *   tour de rôle, consomment 4,5 kWh, quelle que soit la puissance du câble.
 * - La PUISSANCE détermine ce qui PASSE DANS LE CÂBLE À L'INSTANT. Les trois
 *   mêmes radiateurs allumés EN MÊME TEMPS demandent 4 500 W simultanés, or une
 *   prise de marché fournit souvent 16 A (~3 500 W) : au-delà, ÇA DISJONCTE —
 *   le matin, quand tout démarre en même temps, un dimanche de décembre.
 *
 * Deux familles de fonctions, donc, jamais mélangées :
 *  - `sommePuissanceEnServiceW` / `diagnosticPuissanceLieu` : le risque de
 *    disjonction, qui ne dépend QUE des puissances nominales déclarées ;
 *  - `energieKWh` / `coutEnergieSessionCents` : le coût, qui dépend EN PLUS
 *    d'une durée d'usage et du mode de facturation du lieu.
 *
 * ## NULL veut dire inconnu, jamais zéro (même doctrine que `deplacement.ts`)
 *
 * Une puissance disponible non renseignée sur un lieu ne permet PAS de
 * conclure qu'il n'y a pas de risque de disjonction : elle rend le diagnostic
 * `null`, à charge pour l'écran de le dire plutôt que d'afficher un « OK »
 * qui n'a rien vérifié. Symétriquement (D-055), l'absence d'information sur
 * l'électricité d'un lieu ne doit JAMAIS être lue comme une disponibilité
 * optimiste : se tromper en disant « je ne sais pas » ne coûte qu'une occasion
 * manquée, l'inverse coûte une session ratée.
 *
 * ## Le piège du prix du kWh
 *
 * Sur beaucoup d'emplacements, l'électricité n'est PAS facturée au compteur :
 * comprise dans le tarif d'emplacement, ou facturée au forfait journalier.
 * Calculer un coût en kWh dans ces cas inventerait une dépense qui n'existe
 * pas, et la compterait DEUX FOIS avec le tarif d'emplacement
 * (`lieu_marche.facturation_electricite`). `coutEnergieSessionCents` ne
 * calcule donc un coût QUE pour le mode `compteur`, et seulement si un prix du
 * kWh est fourni — jamais inventé ici (CLAUDE.md §7). La quantité physique
 * (kWh), elle, reste toujours calculable : c'est une mesure, pas un prix.
 */

import type { CategorieIngredient, FacturationElectricite } from './contrats/referentiel.js';
import type { TypeEquipement } from './contrats/energie.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Puissance et risque de disjonction
   ═══════════════════════════════════════════════════════════════════════════ */

export type EquipementPourDiagnostic = {
  readonly puissanceW: number;
  /** `false` = déclaré pour comparaison avant achat, pas en service. */
  readonly enService: boolean;
  /** Un équipement retiré (`actif = false`) ne tourne plus jamais. */
  readonly actif: boolean;
};

/**
 * Somme des puissances nominales des équipements RÉELLEMENT en service —
 * ceux qui partent au marché, pas ceux déclarés seulement pour comparer un
 * achat. C'est ce qui demanderait à passer dans le câble si tout tournait en
 * même temps.
 */
export function sommePuissanceEnServiceW(equipements: readonly EquipementPourDiagnostic[]): number {
  return equipements
    .filter((equipement) => equipement.enService && equipement.actif)
    .reduce((total, equipement) => total + equipement.puissanceW, 0);
}

export type DiagnosticPuissanceLieu = {
  readonly puissanceRequiseW: number;
  readonly puissanceDisponibleW: number | null;
  /** `puissanceDisponibleW - puissanceRequiseW`. `null` si disponible inconnue. */
  readonly margeW: number | null;
  /** `null` : disponibilité inconnue, jamais « pas de risque ». */
  readonly risqueDisjonction: boolean | null;
  /** `null` seulement quand il n'y a rien à signaler. */
  readonly avertissement: string | null;
};

/**
 * Compare la puissance REQUISE (somme des équipements en service) à la
 * puissance DISPONIBLE sur un lieu, et dit si ça disjoncte.
 *
 * `puissanceDisponibleW === null` : le lieu n'a pas de puissance disponible
 * renseignée — jamais interprété comme « illimitée » ni comme « nulle »
 * (D-055). Le diagnostic reste `null`, avec un avertissement qui dit POURQUOI
 * on ne sait pas, sauf si aucun appareil n'est en service (rien à risquer).
 */
export function diagnosticPuissanceLieu(
  puissanceRequiseW: number,
  puissanceDisponibleW: number | null,
): DiagnosticPuissanceLieu {
  if (puissanceDisponibleW === null) {
    return {
      puissanceRequiseW,
      puissanceDisponibleW: null,
      margeW: null,
      risqueDisjonction: null,
      avertissement:
        puissanceRequiseW > 0
          ? `Puissance disponible non renseignée pour ce lieu : impossible de dire si ` +
            `${puissanceRequiseW} W d'équipements en service passeront sans disjoncter.`
          : null,
    };
  }

  const margeW = puissanceDisponibleW - puissanceRequiseW;
  const risqueDisjonction = margeW < 0;

  return {
    puissanceRequiseW,
    puissanceDisponibleW,
    margeW,
    risqueDisjonction,
    avertissement: risqueDisjonction
      ? `${puissanceRequiseW} W prévus pour ${puissanceDisponibleW} W disponibles : ` +
        `${Math.abs(margeW)} W de trop si tout tourne en même temps, certains appareils ` +
        `devront alterner.`
      : null,
  };
}

/**
 * Disponibilité de l'électricité sur un lieu, déduite du mode de facturation
 * (D-055). `null` = inconnu, jamais lu comme disponible (aucune valeur par
 * défaut optimiste) : seul `'aucune'` affirme positivement l'absence de
 * courant.
 */
export function electriciteDisponibleLieu(
  facturationElectricite: FacturationElectricite | null,
): boolean | null {
  if (facturationElectricite === null) return null;
  return facturationElectricite !== 'aucune';
}

/* ═══════════════════════════════════════════════════════════════════════════
   Énergie et coût
   ═══════════════════════════════════════════════════════════════════════════ */

/** Énergie consommée par un appareil, en kilowattheures. Une mesure, jamais un prix. */
export function energieKWh(puissanceW: number, dureeMinutes: number): number {
  return (puissanceW * dureeMinutes) / 60 / 1000;
}

export type EntreeCoutEnergieSession = {
  readonly equipementsUtilises: readonly {
    readonly puissanceW: number;
    readonly dureeMinutes: number;
  }[];
  /** `lieu_marche.facturation_electricite`. `null` = inconnu (jamais « compteur »). */
  readonly facturationElectricite: FacturationElectricite | null;
  /**
   * Tarif du kWh en centimes d'euro, tel que lu dans `packages/core/src/
   * parametres.ts`. `null` quand la clé n'est pas encore renseignée : le
   * calcul reste alors silencieux plutôt que d'inventer un prix (CLAUDE.md §7).
   */
  readonly prixKwhCentsParKwh: number | null;
};

export type ResultatCoutEnergieSession = {
  /** Quantité physique, TOUJOURS calculable — une mesure, pas un prix. */
  readonly kwh: number;
  /** `null` : voir `raisonIndisponible`. */
  readonly cents: number | null;
  /** Explique un `cents` à `null`, jamais un silence sur pourquoi. */
  readonly raisonIndisponible: string | null;
};

/**
 * Coût d'électricité d'UNE session, à partir des équipements réellement
 * utilisés et de leur durée.
 *
 * Le calcul ne s'applique QUE si le lieu facture au compteur ET qu'un prix du
 * kWh est disponible : sur beaucoup d'emplacements l'électricité est comprise
 * dans le tarif d'emplacement ou facturée au forfait journalier, et calculer
 * un coût en kWh dans ces cas l'inventerait et le compterait DEUX FOIS
 * (docs/demandes/17 « le piège du prix du kWh »). La quantité physique (kWh),
 * elle, reste toujours rendue : ce n'est jamais elle qui est incertaine.
 */
export function coutEnergieSessionCents(
  entrees: EntreeCoutEnergieSession,
): ResultatCoutEnergieSession {
  const kwh = entrees.equipementsUtilises.reduce(
    (total, e) => total + energieKWh(e.puissanceW, e.dureeMinutes),
    0,
  );

  switch (entrees.facturationElectricite) {
    case null:
      return {
        kwh,
        cents: null,
        raisonIndisponible:
          "Mode de facturation de l'électricité inconnu pour ce lieu : impossible de dire " +
          "si un coût s'ajoute au tarif d'emplacement.",
      };
    case 'aucune':
      return {
        kwh,
        cents: null,
        raisonIndisponible:
          "Ce lieu ne dispose d'aucune électricité : aucun coût d'électricité ne s'applique.",
      };
    case 'forfait':
      return {
        kwh,
        cents: null,
        raisonIndisponible:
          'Électricité facturée au forfait journalier sur ce lieu : son coût est déjà compté ' +
          "dans le tarif d'emplacement — un coût au kWh le compterait deux fois.",
      };
    case 'comprise':
      return {
        kwh,
        cents: null,
        raisonIndisponible:
          "Électricité comprise dans le tarif d'emplacement de ce lieu : un coût au kWh le " +
          'compterait deux fois.',
      };
    case 'compteur':
      if (entrees.prixKwhCentsParKwh === null) {
        return {
          kwh,
          cents: null,
          raisonIndisponible: 'Prix du kWh non paramétré.',
        };
      }
      return {
        kwh,
        cents: Math.round(kwh * entrees.prixKwhCentsParKwh),
        raisonIndisponible: null,
      };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Point d'équilibre d'une autoproduction (solaire, éolien) — docs/demandes/17
   §3
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Types d'équipement qu'une autoproduction MOBILE et MODESTE (solaire,
 * éolien) peut RÉALISTEMENT alimenter (docs/demandes/17 §3.1) : éclairage,
 * froid actif, terminal de paiement.
 *
 * JAMAIS la cuisson (une plaque à crêpes professionnelle développe plusieurs
 * kilowatts) ni le chauffage (un radiateur d'appoint tire 1 000 à 2 000 W,
 * §4bis.4) : une installation mobile modeste ne fait tourner ni l'une ni
 * l'autre. C'est le garde-fou NON NÉGOCIABLE de cette fiche — comparer le
 * coût des panneaux à TOUT le budget gaz (presque entièrement de la cuisson)
 * donnerait un point d'équilibre bien trop optimiste. Ce filtre est ce qui
 * l'empêche : voir `coutEnergieEviteeAutoproductionMoyenne`.
 */
export const TYPES_EQUIPEMENT_AUTOPRODUCTION_MOBILE: readonly TypeEquipement[] = [
  'eclairage',
  'froid',
  'paiement',
];

/** `true` si ce type d'équipement peut être réalistement alimenté par une autoproduction mobile modeste (voir `TYPES_EQUIPEMENT_AUTOPRODUCTION_MOBILE`). */
export function estCompatibleAutoproductionMobile(type: TypeEquipement): boolean {
  return (TYPES_EQUIPEMENT_AUTOPRODUCTION_MOBILE as readonly string[]).includes(type);
}

/**
 * Rappel affichable tel quel à l'écran (docs/demandes/17 §3.1) : le garde-fou
 * ci-dessus n'a de valeur que si l'utilisateur le VOIT, pas seulement s'il est
 * respecté en coulisse.
 */
export const AVERTISSEMENT_POINT_EQUILIBRE_AUTOPRODUCTION =
  "Ce calcul ne compte que l'électricité qui serait sinon payée AU COMPTEUR pour l'éclairage, " +
  'le terminal de paiement et un petit froid actif : une installation solaire ou éolienne ' +
  'mobile ne fait tourner ni une plaque de cuisson (plusieurs kW) ni un radiateur électrique ' +
  '(1 000 à 2 000 W). Il ne représente donc JAMAIS le budget gaz total ni le chauffage.';

export type EntreePointEquilibreAutoproduction = {
  /** `immobilisation.montantCents` — coût d'acquisition de l'installation. `null` : rien à comparer. */
  readonly coutInstallationCents: number | null;
  /**
   * Coût d'énergie moyen évité par session, en centimes. JAMAIS le budget gaz
   * total (voir `AVERTISSEMENT_POINT_EQUILIBRE_AUTOPRODUCTION`) : uniquement
   * l'électricité qui serait autrement payée AU COMPTEUR pour des équipements
   * compatibles (`TYPES_EQUIPEMENT_AUTOPRODUCTION_MOBILE`). `null` : pas
   * encore mesurable — jamais remplacé par une estimation.
   */
  readonly coutEnergieEviteParSessionCents: number | null;
};

export type ResultatPointEquilibreAutoproduction = {
  /** Nombre de sessions ENTIÈRES avant remboursement — arrondi au SUPÉRIEUR : la session qui termine de rembourser compte entière. */
  readonly sessionsAvantEquilibre: number | null;
  /** Explique un `sessionsAvantEquilibre` à `null` — jamais un silence sur pourquoi. */
  readonly raisonIndisponible: string | null;
};

/**
 * Nombre de sessions avant que l'installation ne soit remboursée par
 * l'électricité qu'on ne paie plus (docs/demandes/17 §3.1) :
 *
 *   sessions avant équilibre = coût de l'installation ÷ coût évité par session
 *
 * Fonction GÉNÉRIQUE et volontairement AVEUGLE À LA SOURCE : elle ne sait pas
 * si `coutInstallationCents` vient d'un panneau solaire ou d'une éolienne
 * (§3.2 — « l'éolien est une immobilisation de plus, rien à modéliser à
 * part ») ni d'où vient le coût évité. C'est à L'APPELANT de garantir que ce
 * dernier respecte le garde-fou (jamais le budget gaz total, jamais le
 * chauffage) — exactement le rôle de `coutEnergieEviteeAutoproductionMoyenne`
 * ci-dessous.
 */
export function pointEquilibreAutoproduction(
  entree: EntreePointEquilibreAutoproduction,
): ResultatPointEquilibreAutoproduction {
  if (entree.coutInstallationCents === null) {
    return { sessionsAvantEquilibre: null, raisonIndisponible: "Coût d'installation inconnu." };
  }
  if (entree.coutInstallationCents <= 0) {
    return {
      sessionsAvantEquilibre: null,
      raisonIndisponible: "Coût d'installation invalide : il doit être strictement positif.",
    };
  }
  if (entree.coutEnergieEviteParSessionCents === null) {
    return {
      sessionsAvantEquilibre: null,
      raisonIndisponible:
        "Coût d'énergie évité par session inconnu : aucune session ne permet encore de le " +
        'mesurer (lieu facturé au compteur, prix du kWh paramétré, équipement compatible en ' +
        'service — éclairage, froid actif, terminal de paiement).',
    };
  }
  if (entree.coutEnergieEviteParSessionCents <= 0) {
    return {
      sessionsAvantEquilibre: null,
      raisonIndisponible:
        "Aucune économie d'énergie mesurée par session : l'installation ne se rembourse par " +
        'aucun coût évité connu.',
    };
  }

  return {
    sessionsAvantEquilibre: Math.ceil(
      entree.coutInstallationCents / entree.coutEnergieEviteParSessionCents,
    ),
    raisonIndisponible: null,
  };
}

export type LigneUtilisationPourAutoproduction = {
  readonly sessionId: string;
  readonly type: TypeEquipement;
  readonly puissanceW: number;
  readonly dureeMinutes: number;
  /** Mode de facturation du LIEU de cette session. `null` = inconnu. */
  readonly facturationElectricite: FacturationElectricite | null;
};

export type ResultatCoutEnergieEviteeMoyenne = {
  readonly coutMoyenParSessionCents: number | null;
  readonly nbSessionsPriseEnCompte: number;
  /** Explique un `coutMoyenParSessionCents` à `null`. */
  readonly raisonIndisponible: string | null;
};

/**
 * Coût d'électricité moyen ÉVITÉ par session, restreint aux équipements
 * qu'une autoproduction mobile modeste peut RÉALISTEMENT alimenter
 * (`estCompatibleAutoproductionMobile`). JAMAIS la cuisson ni le chauffage —
 * `AVERTISSEMENT_POINT_EQUILIBRE_AUTOPRODUCTION` ci-dessus.
 *
 * Moyenne sur les sessions qui ont, pour au moins un équipement compatible,
 * une durée d'utilisation enregistrée ET un lieu facturé AU COMPTEUR avec un
 * prix du kWh connu — exactement les conditions déjà posées par
 * `coutEnergieSessionCents`. Ailleurs (forfait, compris, aucune électricité,
 * lieu ou prix inconnu), aucun coût réel n'est évité : les exclure est le
 * résultat correct, pas un manque de données.
 *
 * Fonction PURE : `lignes` est déjà assemblée par l'appelant (une ligne par
 * couple session × équipement en usage, déjà jointe au mode de facturation du
 * lieu) — cette fonction ne lit rien, elle groupe et moyenne.
 */
export function coutEnergieEviteeAutoproductionMoyenne(
  lignes: readonly LigneUtilisationPourAutoproduction[],
  prixKwhCentsParKwh: number | null,
): ResultatCoutEnergieEviteeMoyenne {
  const equipementsParSession = new Map<string, { puissanceW: number; dureeMinutes: number }[]>();
  const facturationParSession = new Map<string, FacturationElectricite | null>();

  for (const ligne of lignes) {
    if (!estCompatibleAutoproductionMobile(ligne.type)) continue;
    const liste = equipementsParSession.get(ligne.sessionId) ?? [];
    liste.push({ puissanceW: ligne.puissanceW, dureeMinutes: ligne.dureeMinutes });
    equipementsParSession.set(ligne.sessionId, liste);
    facturationParSession.set(ligne.sessionId, ligne.facturationElectricite);
  }

  const coutsCents: number[] = [];
  for (const [sessionId, equipementsUtilises] of equipementsParSession) {
    const resultat = coutEnergieSessionCents({
      equipementsUtilises,
      facturationElectricite: facturationParSession.get(sessionId) ?? null,
      prixKwhCentsParKwh,
    });
    if (resultat.cents !== null) coutsCents.push(resultat.cents);
  }

  if (coutsCents.length === 0) {
    return {
      coutMoyenParSessionCents: null,
      nbSessionsPriseEnCompte: 0,
      raisonIndisponible:
        "Aucune session ne permet de mesurer un coût d'électricité évité : il faut au moins " +
        'un équipement compatible (éclairage, froid actif, terminal de paiement) en service ' +
        'sur un lieu facturé AU COMPTEUR avec un prix du kWh paramétré.',
    };
  }

  const total = coutsCents.reduce((somme, c) => somme + c, 0);
  return {
    coutMoyenParSessionCents: Math.round(total / coutsCents.length),
    nbSessionsPriseEnCompte: coutsCents.length,
    raisonIndisponible: null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Empreinte — quantités physiques (docs/demandes/17 §4)
   ═══════════════════════════════════════════════════════════════════════════

   CE QUI EST CONSTRUIT ICI : un tableau de QUANTITÉS PHYSIQUES (kilos,
   litres, kWh, pièces) — honnête, sans donnée externe.

   CE QUI N'EST PAS CONSTRUIT ICI, ET NE LE SERA PAS SANS SOURCE : la
   conversion en CO2. Les facteurs d'émission sont des données réglementaires
   EXTERNES (CLAUDE.md §7 : table `parametre`, source et date de validité
   obligatoires) et un LLM n'en calcule ni n'en estime aucun (CLAUDE.md §3
   règle n°2). Afficher « 0,42 kg CO2 par crêpe » avec un facteur inventé
   serait pire que ne rien afficher — c'est le greenwashing involontaire que
   la fiche nomme explicitement. Tant qu'aucune source publique datable n'est
   ajoutée au catalogue de `parametres.ts`, cette conversion reste absente,
   et `AVERTISSEMENT_EMPREINTE_CARBONE` le dit à l'écran. */

/** Même union que `ingredient.unite_reference` (schema.ts) / `schemaUnite` (contrats/recettes.ts). */
export type UniteIngredient = 'g' | 'ml' | 'piece';

export const AVERTISSEMENT_EMPREINTE_CARBONE =
  'Ce tableau montre des quantités PHYSIQUES (kilos, litres, kWh, pièces), jamais un poids de ' +
  "CO2 : les facteurs d'émission sont des données réglementaires externes, non sourcées ici. " +
  'Afficher un chiffre de CO2 inventé serait pire que ne rien afficher — la conversion viendra ' +
  'le jour où une source publique datée sera ajoutée au catalogue des paramètres.';

export type LigneLotPourEmpreinte = {
  readonly ingredientId: string;
  /** `lot.quantite_initiale` — quantité REÇUE à réception, pas consommée. */
  readonly quantiteInitiale: number;
};

export type IngredientPourEmpreinte = {
  readonly id: string;
  readonly nom: string;
  readonly categorie: CategorieIngredient;
  readonly uniteReference: UniteIngredient;
};

export type QuantitePhysiqueIngredient = {
  readonly ingredientId: string;
  readonly nom: string;
  readonly categorie: CategorieIngredient;
  readonly uniteReference: UniteIngredient;
  readonly quantiteRecue: number;
};

/**
 * Quantités physiques REÇUES, PAR INGRÉDIENT — jamais par catégorie
 * (docs/demandes/17 §4.2).
 *
 * Deux ingrédients de la MÊME catégorie (deux consommables, par exemple)
 * peuvent avoir des `uniteReference` DIFFÉRENTES (g, ml, piece). Les sommer
 * par catégorie mélangerait des grammes avec des pièces — exactement
 * l'erreur que CLAUDE.md §3 règle n°4 interdit pour les conversions
 * masse/volume. Chaque ligne reste dans SON unité déclarée.
 *
 * Le gaz (`categorie = 'gaz'`) et les consommables (fiche 15 — serviettes,
 * gobelets, assiettes, `categorie = 'consommable'`) ressortent donc
 * naturellement dans cette même liste, sans code spécifique : ce sont déjà
 * des ingrédients comme les autres pour le modèle de données.
 */
export function quantitesPhysiquesParIngredient(
  lots: readonly LigneLotPourEmpreinte[],
  ingredients: readonly IngredientPourEmpreinte[],
): QuantitePhysiqueIngredient[] {
  const parIngredient = new Map(ingredients.map((i) => [i.id, i] as const));
  const totaux = new Map<string, number>();

  for (const ligne of lots) {
    totaux.set(ligne.ingredientId, (totaux.get(ligne.ingredientId) ?? 0) + ligne.quantiteInitiale);
  }

  const resultat: QuantitePhysiqueIngredient[] = [];
  for (const [ingredientId, quantiteRecue] of totaux) {
    const ingredient = parIngredient.get(ingredientId);
    // Improbable (contrainte de clé étrangère) : un lot sans ingrédient
    // retrouvable n'est pas affichable, plutôt que de deviner sa catégorie.
    if (ingredient === undefined) continue;
    resultat.push({
      ingredientId,
      nom: ingredient.nom,
      categorie: ingredient.categorie,
      uniteReference: ingredient.uniteReference,
      quantiteRecue,
    });
  }

  return resultat.sort((a, b) => a.nom.localeCompare(b.nom));
}

export type LigneDeplacementPourEmpreinte = {
  /** `lieu_marche.distance_km` — ALLER SIMPLE. `null` = inconnue. */
  readonly distanceKmAllerSimple: number | null;
};

export type ResultatKilometresParcourus = {
  readonly totalKm: number;
  /** Sessions exclues du total faute de distance connue — jamais comptées comme 0 km. */
  readonly nbSessionsDistanceInconnue: number;
};

/**
 * Kilomètres ALLER-RETOUR (× 2, même convention que `coutDeplacementSessionCents`
 * de `deplacement.ts`, D-060) parcourus sur un ensemble de sessions.
 *
 * Une distance inconnue EXCLUT la session du total — jamais comptée comme
 * 0 km — et son compte est rendu à part, pour que l'écran dise que le total
 * est un PLANCHER, pas une mesure complète.
 */
export function kilometresParcourusAllerRetour(
  lignes: readonly LigneDeplacementPourEmpreinte[],
): ResultatKilometresParcourus {
  let totalKm = 0;
  let nbSessionsDistanceInconnue = 0;

  for (const ligne of lignes) {
    if (ligne.distanceKmAllerSimple === null) nbSessionsDistanceInconnue += 1;
    else totalKm += ligne.distanceKmAllerSimple * 2;
  }

  return { totalKm, nbSessionsDistanceInconnue };
}

export type LigneUtilisationPourEmpreinte = {
  readonly puissanceW: number;
  readonly dureeMinutes: number;
};

/**
 * Énergie électrique TOTALE consommée, en kWh, TOUS types d'équipement
 * confondus.
 *
 * Contrairement au point d'équilibre solaire (§3), l'empreinte physique ne
 * filtre PAS par type : la cuisson et le chauffage électriques pèsent bien
 * dans l'empreinte, même si une autoproduction mobile ne peut pas les
 * fournir.
 */
export function energieElectriqueTotaleKwh(
  lignes: readonly LigneUtilisationPourEmpreinte[],
): number {
  return lignes.reduce(
    (somme, ligne) => somme + energieKWh(ligne.puissanceW, ligne.dureeMinutes),
    0,
  );
}
