/**
 * Validation de la VALEUR d'un paramètre contre le type déclaré au catalogue.
 *
 * `parametres-ecriture.test.ts` exerce le type `entier` (le plus répandu) et
 * les refus de source / de rétroactivité. Deux des cinq validateurs n'étaient
 * jamais appelés : `decimal` et `json`. Et le format de la date de début de
 * validité — le seul contrôle qui décide À PARTIR DE QUAND un seuil légal
 * s'applique — ne l'était pas non plus.
 *
 * L'enjeu n'est pas la propreté de la saisie. `Parametres.decimal()` lit ces
 * chaînes ; une valeur qui traverserait la garde produirait `NaN` au fond d'un
 * calcul de prévision ou de température AFSCA, sans rien lever au passage.
 *
 * Le cinquième validateur (`booleen`) reste volontairement non couvert : voir
 * la note en fin de fichier.
 */

import { ErreurMetier } from '@batte/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { parametre } from '../schema.js';
import { ajouterVersionParametre, corrigerParametre } from './parametres.js';

/** Clé `decimal` du catalogue : température maximale de la chaîne du froid. */
const CLE_DECIMAL = 'temperature_max_froid_c';
/** Clé `json` du catalogue : motifs ouvrant une non-conformité AFSCA. */
const CLE_JSON = 'afsca_motifs_incident_sanitaire_json';
/** Clé `texte` du catalogue : l'adresse de départ, qui PEUT être vide. */
const CLE_TEXTE = 'adresse_depart_defaut';

function attendCode(fn: () => unknown, code: string): ErreurMetier {
  try {
    fn();
    expect.unreachable(`devait lever une ErreurMetier de code « ${code} »`);
  } catch (erreur) {
    expect(erreur).toBeInstanceOf(ErreurMetier);
    expect((erreur as ErreurMetier).code).toBe(code);
    return erreur as ErreurMetier;
  }
  throw new Error('inatteignable');
}

describe('corrigerParametre — contrôle de type par le catalogue', () => {
  let base: BaseBatte;

  /** Identifiant de LIGNE d'une clé (c'est lui, pas la clé, que la route passe). */
  function idDe(cle: string): string {
    return base.select({ id: parametre.id }).from(parametre).where(eq(parametre.cle, cle)).get()!
      .id;
  }

  function valeurDe(cle: string): string {
    return base
      .select({ valeur: parametre.valeur })
      .from(parametre)
      .where(eq(parametre.cle, cle))
      .get()!.valeur;
  }

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
  });

  /* ── decimal ─────────────────────────────────────────────────────────── */

  it('accepte un décimal au point, et l’écrit réellement', () => {
    corrigerParametre(base, idDe(CLE_DECIMAL), '6.5');
    expect(valeurDe(CLE_DECIMAL)).toBe('6.5');
  });

  it('accepte un décimal négatif — une température de congélateur en est un', () => {
    corrigerParametre(base, idDe(CLE_DECIMAL), '-18');
    expect(valeurDe(CLE_DECIMAL)).toBe('-18');
  });

  it('refuse une valeur décimale non numérique, et n’écrit RIEN', () => {
    const avant = valeurDe(CLE_DECIMAL);
    const erreur = attendCode(
      () => corrigerParametre(base, idDe(CLE_DECIMAL), 'sept virgule cinq'),
      'valeur_parametre_invalide',
    );
    expect(erreur.champs).toHaveProperty('valeur');
    expect(valeurDe(CLE_DECIMAL)).toBe(avant);
  });

  it('refuse la virgule décimale — c’est le point qui est attendu, pas une convention locale', () => {
    // « 6,5 » donne NaN par `Number()`. Sans ce refus, la chaîne partirait en
    // base et ne se manifesterait qu'au premier relevé de température comparé.
    attendCode(
      () => corrigerParametre(base, idDe(CLE_DECIMAL), '6,5'),
      'valeur_parametre_invalide',
    );
  });

  it('refuse un décimal VIDE — `Number("")` vaut 0, ce qui passerait pour un vrai zéro', () => {
    attendCode(
      () => corrigerParametre(base, idDe(CLE_DECIMAL), '   '),
      'valeur_parametre_invalide',
    );
  });

  it('accepte en revanche un TEXTE vide : vide veut dire INCONNU, jamais zéro', () => {
    // Discrimine : si la garde du vide était posée sur tous les types, cette
    // adresse ne pourrait plus jamais être remise à « pas encore renseignée ».
    corrigerParametre(base, idDe(CLE_TEXTE), '');
    expect(valeurDe(CLE_TEXTE)).toBe('');
  });

  /* ── json ────────────────────────────────────────────────────────────── */

  it('accepte un tableau JSON valide', () => {
    corrigerParametre(base, idDe(CLE_JSON), '["DLC_DEPASSEE"]');
    expect(valeurDe(CLE_JSON)).toBe('["DLC_DEPASSEE"]');
  });

  it('refuse un JSON malformé, et n’écrit RIEN', () => {
    const avant = valeurDe(CLE_JSON);
    attendCode(
      () => corrigerParametre(base, idDe(CLE_JSON), '["DLC_DEPASSEE",'),
      'valeur_parametre_invalide',
    );
    expect(valeurDe(CLE_JSON)).toBe(avant);
  });
});

describe('ajouterVersionParametre — format de la date de début de validité', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
  });

  it('refuse une date qui n’est pas au format AAAA-MM-JJ', () => {
    const erreur = attendCode(
      () =>
        ajouterVersionParametre(base, {
          cle: CLE_DECIMAL,
          valeur: '4',
          dateDebutValidite: '01/01/2027',
          source: 'AFSCA, arrêté royal',
        }),
      'date_validite_invalide',
    );
    expect(erreur.champs).toHaveProperty('dateDebutValidite');
  });

  it('refuse une date vide', () => {
    attendCode(
      () =>
        ajouterVersionParametre(base, {
          cle: CLE_DECIMAL,
          valeur: '4',
          dateDebutValidite: '',
          source: 'AFSCA, arrêté royal',
        }),
      'date_validite_invalide',
    );
  });

  it('accepte la MÊME saisie avec une date bien formée — le refus porte sur le format seul', () => {
    // Discrimine : sans ce cas, le refus pourrait venir de la valeur ou de la
    // source plutôt que de la date.
    const id = ajouterVersionParametre(base, {
      cle: CLE_DECIMAL,
      valeur: '4',
      dateDebutValidite: '2027-01-01',
      source: 'AFSCA, arrêté royal',
    });
    expect(id).toBeTypeOf('string');
  });
});

/**
 * NON COUVERT ET DOIT LE RESTER — le validateur `booleen`
 * (`packages/db/src/depots/parametres.ts`, lignes 151-155).
 *
 * `TypeValeurParametre` déclare cinq types, mais AUCUNE entrée de
 * `CATALOGUE_PARAMETRES` (`packages/core/src/parametres.ts`) n'est de type
 * `booleen` à ce jour — vérifiable par `grep "typeValeur: 'booleen'"`, qui ne
 * renvoie rien. Or `verifierValeur` sélectionne le validateur PAR le type
 * déclaré au catalogue : tant qu'aucune clé n'est déclarée booléenne, cette
 * branche n'est atteignable par aucun appel.
 *
 * L'atteindre exigerait soit d'ajouter une clé au catalogue (une modification
 * de code de production pour faire monter un pourcentage), soit de fabriquer
 * une `DefinitionParametre` factice et d'appeler une fonction PRIVÉE — un test
 * qui prouverait qu'un cas impossible se comporte bien, ce que la consigne de
 * ce dépôt interdit explicitement. La branche redeviendra couvrable d'elle-même
 * le jour où un vrai paramètre booléen entrera au catalogue.
 */
