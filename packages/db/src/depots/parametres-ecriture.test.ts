/**
 * Ecriture des parametres — les deux gestes, et ce qui les separe.
 *
 * L'enjeu de ce fichier tient en une phrase : **faire evoluer un seuil ne doit
 * jamais reecrire une session deja cloturee.** `lireParametres(base, date)`
 * resout les parametres A UNE DATE, precisement pour qu'une session de mars se
 * relise avec les taux de mars. Si une nouvelle version ecrasait l'ancienne, ou
 * si elle pouvait etre antidatee, une piece comptable close changerait de
 * montant sans que personne ne touche a la piece (D-004 / D-024).
 *
 *  - `ajouterVersionParametre` = la valeur etait juste, elle change a partir
 *    d'une date. Le passe est intact.
 *  - `corrigerParametre` = la valeur n'a jamais ete vraie. Le passe est
 *    rectifie, et le journal d'audit garde trace de ce qui a ete rectifie.
 *
 * Aucune assertion ne porte sur une valeur absolue que la graine pourrait
 * deplacer : les attendus derivent du catalogue ou de la ligne reellement lue.
 */

import {
  CATALOGUE_PARAMETRES,
  ErreurIntrouvable,
  ErreurMetier,
  definitionParametre,
  type TypeValeurParametre,
} from '@batte/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { listerJournalAudit } from './audit.js';
import {
  ajouterVersionParametre,
  corrigerParametre,
  lireParametres,
  listerParametres,
} from './parametres.js';

/** Le seuil le plus sensible du projet : sortie de la franchise de TVA. */
const CLE_SEUIL_TVA = 'seuil_franchise_tva_cents';

/** Cle absente du catalogue, donc absente de la base par construction. */
const CLE_INVENTEE = 'seuil_totalement_invente_cents';

function definitionOuEchouer(cle: string) {
  const definition = definitionParametre(cle);
  if (definition === undefined) throw new Error(`Cle absente du catalogue : ${cle}`);
  return definition;
}

/** La ligne telle qu'elle est REELLEMENT en base, jamais une valeur devinee. */
function ligneParametre(base: BaseBatte, cle: string) {
  const ligne = listerParametres(base).find((l) => l.cle === cle);
  if (ligne === undefined) throw new Error(`Parametre non seede : ${cle}`);
  return ligne;
}

/** Premiere cle du catalogue portant le type demande, ou `undefined`. */
function cleDeType(type: TypeValeurParametre): string | undefined {
  return CATALOGUE_PARAMETRES.find((d) => d.typeValeur === type)?.cle;
}

/**
 * Jour civil decale de `jours` par rapport a une date `AAAA-MM-JJ`.
 * Sert a fabriquer des dates RELATIVES a la ligne lue, pour qu'un changement de
 * `dateDebutValidite` dans le catalogue ne casse pas ces tests.
 */
function jourDecale(jour: string, jours: number): string {
  const date = new Date(`${jour}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + jours);
  return date.toISOString().slice(0, 10);
}

describe('ecriture des parametres', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
  });

  describe('faire evoluer — nouvelle version datee', () => {
    /**
     * LE test du fichier. Il demontre qu'une session cloturee avant le
     * changement de seuil continue de se relire avec le seuil de son epoque.
     */
    it('laisse la valeur d’hier intacte pour une lecture datee d’hier', () => {
      const initiale = ligneParametre(base, CLE_SEUIL_TVA);
      const veille = jourDecale(initiale.dateDebutValidite, 1);
      const bascule = jourDecale(initiale.dateDebutValidite, 365);
      const nouvelleValeur = String(Number(initiale.valeur) + 100_000);

      ajouterVersionParametre(base, {
        cle: CLE_SEUIL_TVA,
        valeur: nouvelleValeur,
        dateDebutValidite: bascule,
        source: 'SPF Finances — seuil révisé.',
      });

      // Avant la bascule : l'ancienne valeur, celle qui a servi aux sessions
      // deja cloturees. C'est l'invariant qui protege la comptabilite.
      expect(lireParametres(base, veille).texte(CLE_SEUIL_TVA)).toBe(initiale.valeur);
      // A la bascule meme, et apres : la nouvelle.
      expect(lireParametres(base, bascule).texte(CLE_SEUIL_TVA)).toBe(nouvelleValeur);
      expect(lireParametres(base, jourDecale(bascule, 30)).texte(CLE_SEUIL_TVA)).toBe(
        nouvelleValeur,
      );
    });

    it('ajoute une ligne sans en detruire aucune', () => {
      const initiale = ligneParametre(base, CLE_SEUIL_TVA);
      const versionsAvant = listerParametres(base).filter((l) => l.cle === CLE_SEUIL_TVA);

      const id = ajouterVersionParametre(base, {
        cle: CLE_SEUIL_TVA,
        valeur: '9900000',
        dateDebutValidite: jourDecale(initiale.dateDebutValidite, 400),
        source: 'SPF Finances — seuil révisé.',
      });

      const versionsApres = listerParametres(base).filter((l) => l.cle === CLE_SEUIL_TVA);
      expect(versionsApres).toHaveLength(versionsAvant.length + 1);
      // La ligne d'origine est toujours la, identique au caractere pres.
      expect(versionsApres.find((l) => l.id === initiale.id)).toEqual(initiale);
      expect(versionsApres.find((l) => l.id === id)?.valeur).toBe('9900000');
    });

    it('reprend le type et la description du catalogue sans qu’on les saisisse', () => {
      const definition = definitionOuEchouer(CLE_SEUIL_TVA);
      const initiale = ligneParametre(base, CLE_SEUIL_TVA);

      const id = ajouterVersionParametre(base, {
        cle: CLE_SEUIL_TVA,
        valeur: '2600000',
        dateDebutValidite: jourDecale(initiale.dateDebutValidite, 366),
        source: 'SPF Finances — seuil révisé.',
      });

      const creee = listerParametres(base).find((l) => l.id === id);
      // Le catalogue est la source unique (D-013) : ni le type ni la
      // description ne se ressaisissent a chaque version.
      expect(creee?.typeValeur).toBe(definition.typeValeur);
      expect(creee?.description).toBe(definition.description);
      // Seule la source est propre a la version : un chiffre 2027 ne vient pas
      // du meme texte qu'un chiffre 2026.
      expect(creee?.source).toBe('SPF Finances — seuil révisé.');
    });

    it('refuse une cle absente du catalogue, et n’ecrit rien', () => {
      const totalAvant = listerParametres(base).length;

      expect(() =>
        ajouterVersionParametre(base, {
          cle: CLE_INVENTEE,
          valeur: '1',
          dateDebutValidite: '2030-01-01',
          source: 'Inventé de toutes pièces.',
        }),
      ).toThrow(ErreurIntrouvable);

      // Invariant de stabilite : le total ne bouge pas entre deux lectures.
      expect(listerParametres(base).length).toBe(totalAvant);
      expect(listerJournalAudit(base, { table: 'parametre' })).toHaveLength(0);
    });

    it('refuse une date de validite anterieure ou egale a la version courante', () => {
      const initiale = ligneParametre(base, CLE_SEUIL_TVA);
      const totalAvant = listerParametres(base).length;

      const antidater = (jour: string) =>
        ajouterVersionParametre(base, {
          cle: CLE_SEUIL_TVA,
          valeur: '2600000',
          dateDebutValidite: jour,
          source: 'SPF Finances — seuil révisé.',
        });

      // Anterieure : reecrirait des sessions deja cloturees.
      expect(() => antidater(jourDecale(initiale.dateDebutValidite, -1))).toThrow(ErreurMetier);
      // Egale : la resolution « quelle valeur a cette date ? » deviendrait
      // ambigue, et l'index unique (cle, date_debut_validite) la refuse.
      expect(() => antidater(initiale.dateDebutValidite)).toThrow(ErreurMetier);

      expect(listerParametres(base).length).toBe(totalAvant);
    });

    it('nomme le champ fautif quand la date est retroactive', () => {
      const initiale = ligneParametre(base, CLE_SEUIL_TVA);

      try {
        ajouterVersionParametre(base, {
          cle: CLE_SEUIL_TVA,
          valeur: '2600000',
          dateDebutValidite: jourDecale(initiale.dateDebutValidite, -10),
          source: 'SPF Finances — seuil révisé.',
        });
        expect.unreachable('Une date retroactive doit etre refusee.');
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurMetier);
        const metier = erreur as ErreurMetier;
        // 422 et non 404 : la date vient d'un FORMULAIRE, l'ecran doit savoir
        // sur quel champ accrocher le message (docs/06, conventions d'API).
        expect(metier.statut).toBe(422);
        expect(metier.champs?.dateDebutValidite).toBeDefined();
        // Le message oriente vers l'autre geste, celui qui convient vraiment.
        expect(metier.champs?.dateDebutValidite).toContain('correction');
      }
    });

    it('refuse une source vide : un seuil sans source est invérifiable', () => {
      const initiale = ligneParametre(base, CLE_SEUIL_TVA);

      try {
        ajouterVersionParametre(base, {
          cle: CLE_SEUIL_TVA,
          valeur: '2600000',
          dateDebutValidite: jourDecale(initiale.dateDebutValidite, 366),
          source: '   ',
        });
        expect.unreachable('Une source vide doit etre refusee.');
      } catch (erreur) {
        expect((erreur as ErreurMetier).champs?.source).toBeDefined();
      }
    });

    it('refuse un type incompatible avec le catalogue, en nommant le champ', () => {
      const initiale = ligneParametre(base, CLE_SEUIL_TVA);
      const definition = definitionOuEchouer(CLE_SEUIL_TVA);
      // Un type volontairement different de celui du catalogue.
      const typeFaux: TypeValeurParametre = definition.typeValeur === 'texte' ? 'entier' : 'texte';

      try {
        ajouterVersionParametre(base, {
          cle: CLE_SEUIL_TVA,
          valeur: '2600000',
          typeValeur: typeFaux,
          dateDebutValidite: jourDecale(initiale.dateDebutValidite, 366),
          source: 'SPF Finances — seuil révisé.',
        });
        expect.unreachable('Un type incoherent doit etre refuse.');
      } catch (erreur) {
        expect((erreur as ErreurMetier).champs?.typeValeur).toBeDefined();
      }
    });
  });

  describe('validation de la valeur selon le type declare au catalogue', () => {
    it('refuse un decimal la ou le catalogue attend un entier, champ « valeur » nomme', () => {
      const initiale = ligneParametre(base, CLE_SEUIL_TVA);
      expect(definitionOuEchouer(CLE_SEUIL_TVA).typeValeur).toBe('entier');

      try {
        ajouterVersionParametre(base, {
          cle: CLE_SEUIL_TVA,
          // Un montant est en centimes ENTIERS (CLAUDE.md §3 regle 3).
          valeur: '2600000,5',
          dateDebutValidite: jourDecale(initiale.dateDebutValidite, 366),
          source: 'SPF Finances — seuil révisé.',
        });
        expect.unreachable('Une valeur non entiere doit etre refusee.');
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurMetier);
        const metier = erreur as ErreurMetier;
        expect(metier.statut).toBe(422);
        expect(metier.champs?.valeur).toBeDefined();
      }
    });

    it('applique la meme regle a la correction en place', () => {
      const initiale = ligneParametre(base, CLE_SEUIL_TVA);

      expect(() => corrigerParametre(base, initiale.id, 'vingt-cinq mille')).toThrow(ErreurMetier);
      // Le refus est total : la ligne n'a pas bouge d'un caractere.
      expect(ligneParametre(base, CLE_SEUIL_TVA)).toEqual(initiale);
      expect(listerJournalAudit(base, { table: 'parametre' })).toHaveLength(0);
    });

    it('refuse une valeur vide quel que soit le type', () => {
      const initiale = ligneParametre(base, CLE_SEUIL_TVA);
      expect(() => corrigerParametre(base, initiale.id, '   ')).toThrow(ErreurMetier);
    });

    it('accepte un decimal la ou le catalogue en declare un', () => {
      const cle = cleDeType('decimal');
      // Le catalogue peut evoluer : on n'impose pas qu'un decimal existe.
      if (cle === undefined) return;
      const ligne = ligneParametre(base, cle);

      corrigerParametre(base, ligne.id, '1.65');
      expect(ligneParametre(base, cle).valeur).toBe('1.65');
    });

    it('n’impose aucun format aux parametres declares « texte »', () => {
      const cle = cleDeType('texte');
      if (cle === undefined) return;
      const ligne = ligneParametre(base, cle);

      corrigerParametre(base, ligne.id, 'claude-haiku-4-5-20251001');
      expect(ligneParametre(base, cle).valeur).toBe('claude-haiku-4-5-20251001');
    });
  });

  describe('journal d’audit', () => {
    it('trace la nouvelle version avec sa valeur, sa date de validite et sa source', () => {
      const initiale = ligneParametre(base, CLE_SEUIL_TVA);
      const bascule = jourDecale(initiale.dateDebutValidite, 366);

      const id = ajouterVersionParametre(
        base,
        {
          cle: CLE_SEUIL_TVA,
          valeur: '2600000',
          dateDebutValidite: bascule,
          source: 'SPF Finances — seuil révisé.',
        },
        'Propriétaire',
      );

      const [trace] = listerJournalAudit(base, { table: 'parametre', enregistrementId: id });
      expect(trace?.action).toBe('creation');
      // Pas d'etat « avant » : c'est une ligne neuve, la precedente vit encore
      // dans la table. C'est justement ce qui distingue les deux gestes.
      expect(trace?.valeurAvant).toBeNull();
      expect(trace?.valeurApres?.cle).toBe(CLE_SEUIL_TVA);
      expect(trace?.valeurApres?.valeur).toBe('2600000');
      expect(trace?.valeurApres?.dateDebutValidite).toBe(bascule);
      expect(trace?.valeurApres?.source).toBe('SPF Finances — seuil révisé.');
      expect(trace?.parQui).toBe('Propriétaire');
      // ISO 8601 UTC (CLAUDE.md §3 regle 8) : la date de SAISIE reelle, que la
      // date de debut de validite — declarative — ne renseigne pas.
      expect(trace?.dateAction).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    });

    it('trace la correction avec l’ancienne ET la nouvelle valeur', () => {
      const initiale = ligneParametre(base, CLE_SEUIL_TVA);
      const corrigee = String(Number(initiale.valeur) + 1);

      corrigerParametre(base, initiale.id, corrigee, 'Propriétaire');

      const [trace] = listerJournalAudit(base, {
        table: 'parametre',
        enregistrementId: initiale.id,
      });
      expect(trace?.action).toBe('modification');
      // Sans ces deux instantanes, « quel seuil appliquiez-vous en mars ? »
      // reste sans reponse apres une correction.
      expect(trace?.valeurAvant?.valeur).toBe(initiale.valeur);
      expect(trace?.valeurApres?.valeur).toBe(corrigee);
      expect(trace?.parQui).toBe('Propriétaire');
    });

    it('n’ecrit aucune trace quand l’ecriture est refusee', () => {
      const initiale = ligneParametre(base, CLE_SEUIL_TVA);

      expect(() =>
        ajouterVersionParametre(base, {
          cle: CLE_SEUIL_TVA,
          valeur: 'pas un entier',
          dateDebutValidite: jourDecale(initiale.dateDebutValidite, 366),
          source: 'SPF Finances — seuil révisé.',
        }),
      ).toThrow(ErreurMetier);

      // Un journal qui enregistre des ecritures qui n'ont pas eu lieu ment.
      expect(listerJournalAudit(base, { table: 'parametre' })).toHaveLength(0);
    });
  });

  describe('les deux gestes ne font pas la meme chose', () => {
    /**
     * La preuve par contraste. Meme cle, meme valeur cible, meme date de
     * lecture — et deux resultats opposes. C'est ce qui justifie deux actions
     * distinctes a l'ecran plutot qu'un seul bouton « modifier ».
     */
    it('corriger reecrit le passe, faire evoluer le preserve', () => {
      const initiale = ligneParametre(base, CLE_SEUIL_TVA);
      const veille = jourDecale(initiale.dateDebutValidite, 1);
      const bascule = jourDecale(initiale.dateDebutValidite, 365);
      const cible = String(Number(initiale.valeur) + 500_000);

      // Geste 1 — faire evoluer : la lecture d'hier ne bouge pas.
      ajouterVersionParametre(base, {
        cle: CLE_SEUIL_TVA,
        valeur: cible,
        dateDebutValidite: bascule,
        source: 'SPF Finances — seuil révisé.',
      });
      expect(lireParametres(base, veille).texte(CLE_SEUIL_TVA)).toBe(initiale.valeur);

      // Geste 2 — corriger la ligne d'origine : la lecture d'hier change, et
      // c'est VOULU, puisque la valeur d'origine etait fausse.
      corrigerParametre(base, initiale.id, cible);
      expect(lireParametres(base, veille).texte(CLE_SEUIL_TVA)).toBe(cible);
    });
  });
});
