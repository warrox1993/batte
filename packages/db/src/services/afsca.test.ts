/**
 * Tests d'integration du Lot 8 — registre AFSCA.
 *
 * Couvre les regles explicitement exigees par le prompt du lot : seuil de
 * temperature parametrable et fige, action corrective obligatoire sur un
 * relevé non conforme, tachesEnRetard selon la frequence, et non-conformites /
 * exercice de tracabilite qui n'acceptent pas une cloture sans contenu.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ErreurIntrouvable, ErreurMetier } from '@batte/core';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import { seedAfsca } from '../seed/afsca.js';
import { lieuMarche, produitVente } from '../schema.js';
import { ajouterVersionParametre } from '../depots/parametres.js';
import { creerSession, cloturerSession, annulerSession } from './sessions.js';
import {
  annulerReleveTemperature,
  cloturerNonConformite,
  declarerNonConformite,
  ecrireReleveTemperature,
  enregistrerExecutionNettoyage,
  enregistrerExerciceTracabilite,
  enregistrerReleveTemperature,
  executionsNettoyagePeriode,
  listerExercicesTracabilite,
  listerNonConformites,
  listerRelevesTemperature,
  listerTachesNettoyage,
  nonConformitesPeriode,
  relevesTemperaturePeriode,
  sessionsSansReleveTemperature,
  tachesEnRetard,
} from './afsca.js';

const JOUR = '2026-07-27';

describe('Lot 8 — registre AFSCA', () => {
  let base: BaseBatte;
  let idLieu: string;
  let idCrepe: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);
    idLieu = base.select({ id: lieuMarche.id }).from(lieuMarche).get()!.id;
    idCrepe = base.select({ id: produitVente.id }).from(produitVente).get()!.id;
  });

  /** Cloture une session minimale un jour donne, pour les tests de nettoyage. */
  function cloturerSessionAu(jour: string) {
    const session = creerSession(base, { lieuId: idLieu, dateSession: jour });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idCrepe, quantite: 10, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 3000,
      caCarteCents: 0,
      crepesProduites: 10,
      crepesInvendues: 0,
      crepesCassees: 0,
    });
    return session;
  }

  describe('releves de temperature', () => {
    it('est conforme sous le seuil par defaut (7 °C)', () => {
      const releve = enregistrerReleveTemperature(base, {
        equipement: 'Glacière',
        temperatureC: 4,
        dateReleve: JOUR,
        moment: 'depart',
      });

      expect(releve.conforme).toBe(true);
      expect(releve.actionCorrective).toBeNull();
    });

    it('refuse un releve non conforme sans action corrective', () => {
      expect(() =>
        enregistrerReleveTemperature(base, {
          equipement: 'Glacière',
          temperatureC: 9,
          dateReleve: JOUR,
          moment: 'retour',
        }),
      ).toThrow(ErreurMetier);

      try {
        enregistrerReleveTemperature(base, {
          equipement: 'Glacière',
          temperatureC: 9,
          dateReleve: JOUR,
          moment: 'retour',
        });
      } catch (erreur) {
        expect((erreur as ErreurMetier).code).toBe('action_corrective_requise');
      }
    });

    it('accepte un releve non conforme avec une action corrective', () => {
      const releve = enregistrerReleveTemperature(base, {
        equipement: 'Glacière',
        temperatureC: 9,
        dateReleve: JOUR,
        moment: 'retour',
        actionCorrective: 'Ajout de blocs eutectiques, transfert au frigo à domicile.',
      });

      expect(releve.conforme).toBe(false);
      expect(releve.actionCorrective).toContain('eutectiques');
    });

    /**
     * Fiche 15 (docs/17) : un relevé hors seuil ouvre AUTOMATIQUEMENT une
     * non-conformité liée, dans la MÊME écriture — sinon les deux onglets du
     * registre se contredisent (« ■ Non conforme » d'un côté, « 0
     * non-conformités, situation attendue » de l'autre).
     */
    it('un releve hors seuil ouvre automatiquement une non-conformite, jamais vide', () => {
      const avant = listerNonConformites(base).length;

      const releve = enregistrerReleveTemperature(base, {
        equipement: 'Glacière',
        temperatureC: 9.5,
        dateReleve: JOUR,
        moment: 'retour',
        actionCorrective: 'Ajout de blocs eutectiques, transfert au frigo à domicile.',
      });

      const nonConformites = listerNonConformites(base);
      expect(nonConformites).toHaveLength(avant + 1);

      const creee = nonConformites.find((n) => n.dateConstat === releve.dateReleve)!;
      expect(creee).toBeDefined();
      // Jamais vide : elle reprend l'action corrective deja exigee et saisie
      // au moment du releve, l'argument « contre l'automatique » de la fiche
      // 15 ne s'applique donc pas ici.
      expect(creee.actionCorrective).toContain('eutectiques');
      expect(creee.dateResolution).toBeNull();
      expect(creee.description).toContain('9.5');
    });

    it('un releve conforme n ouvre AUCUNE non-conformite', () => {
      const avant = listerNonConformites(base).length;

      enregistrerReleveTemperature(base, {
        equipement: 'Glacière',
        temperatureC: 4,
        dateReleve: JOUR,
        moment: 'depart',
      });

      expect(listerNonConformites(base)).toHaveLength(avant);
    });

    it('fige creeLe (instant reel) distinct de dateReleve (date metier)', () => {
      const dateReleveAncienne = '2026-07-20';
      const releve = enregistrerReleveTemperature(base, {
        equipement: 'Glacière',
        temperatureC: 3,
        dateReleve: dateReleveAncienne,
        moment: 'depart',
      });

      expect(releve.dateReleve).toBe(dateReleveAncienne);
      // `creeLe` est un instant ISO complet (horodatage), jamais un simple jour.
      expect(releve.creeLe).toContain('T');
      expect(releve.creeLe.slice(0, 10)).not.toBe(dateReleveAncienne);
    });

    it('lit le seuil en vigueur a la date METIER du releve, jamais un nombre fixe', () => {
      // A partir du 25/07, le seuil est abaisse a 4 °C.
      ajouterVersionParametre(base, {
        cle: 'temperature_max_froid_c',
        valeur: '4',
        typeValeur: 'decimal',
        dateDebutValidite: '2026-07-25',
        source: 'Test — nouveau contrat de maintenance de la glacière.',
        description: 'Seuil abaisse pour le test.',
      });

      // Avant le changement : seuil 7, 5 °C est conforme.
      const avant = enregistrerReleveTemperature(base, {
        equipement: 'Glacière',
        temperatureC: 5,
        dateReleve: '2026-07-20',
        moment: 'depart',
      });
      expect(avant.conforme).toBe(true);

      // Apres le changement : seuil 4, le meme 5 °C ne l'est plus.
      const apres = enregistrerReleveTemperature(base, {
        equipement: 'Glacière',
        temperatureC: 5,
        dateReleve: '2026-07-26',
        moment: 'depart',
        actionCorrective: 'Glace supplémentaire ajoutée.',
      });
      expect(apres.conforme).toBe(false);
    });

    it('liste et filtre par periode', () => {
      enregistrerReleveTemperature(base, {
        equipement: 'Glacière',
        temperatureC: 3,
        dateReleve: '2026-07-10',
        moment: 'depart',
      });
      enregistrerReleveTemperature(base, {
        equipement: 'Glacière',
        temperatureC: 3,
        dateReleve: '2026-07-20',
        moment: 'depart',
      });
      enregistrerReleveTemperature(base, {
        equipement: 'Glacière',
        temperatureC: 3,
        dateReleve: '2026-08-01',
        moment: 'depart',
      });

      expect(listerRelevesTemperature(base)).toHaveLength(3);
      expect(relevesTemperaturePeriode(base, '2026-07-01', '2026-07-31')).toHaveLength(2);
    });

    /**
     * D-083 (31/07/2026) : annulation d'un relevé mal saisi PAR ÉCRITURE
     * NOUVELLE — les deux relevés restent visibles, jamais une suppression ni
     * une réécriture de la valeur d'origine (CLAUDE.md §3 règle 7).
     */
    describe('annulerReleveTemperature — annulation par ecriture nouvelle (D-083)', () => {
      it('bascule le statut a `annulee` SANS toucher la valeur, la date ou creeLe', () => {
        const releve = enregistrerReleveTemperature(base, {
          equipement: 'Glacière',
          temperatureC: 3,
          dateReleve: JOUR,
          moment: 'depart',
        });

        const resultat = annulerReleveTemperature(
          base,
          releve.id,
          'Thermomètre mal calibré, relevé saisi par erreur.',
        );
        expect(resultat.releveId).toBe(releve.id);
        expect(resultat.motif).toContain('mal calibré');

        const [annule] = listerRelevesTemperature(base).filter((r) => r.id === releve.id);
        expect(annule).toBeDefined();
        expect(annule!.statut).toBe('annulee');
        // Rien d'autre ne bouge : la valeur telle que saisie, sa date metier et
        // sa date de saisie reelle restent EXACTEMENT ce qu'elles etaient.
        expect(annule!.temperatureC).toBe(3);
        expect(annule!.dateReleve).toBe(JOUR);
        expect(annule!.creeLe).toBe(releve.creeLe);
      });

      it('refuse un motif vide : le refus vaut mieux qu un motif fabrique', () => {
        const releve = enregistrerReleveTemperature(base, {
          equipement: 'Glacière',
          temperatureC: 3,
          dateReleve: JOUR,
          moment: 'depart',
        });

        expect(() => annulerReleveTemperature(base, releve.id, '')).toThrow(ErreurMetier);
        expect(() => annulerReleveTemperature(base, releve.id, '   ')).toThrow(ErreurMetier);

        try {
          annulerReleveTemperature(base, releve.id, '   ');
        } catch (erreur) {
          expect((erreur as ErreurMetier).code).toBe('motif_obligatoire');
        }

        // Le relevé reste actif : le refus n'a rien ecrit.
        const [toujoursActif] = listerRelevesTemperature(base).filter((r) => r.id === releve.id);
        expect(toujoursActif!.statut).toBe('active');
      });

      it('refuse d annuler deux fois le meme releve', () => {
        const releve = enregistrerReleveTemperature(base, {
          equipement: 'Glacière',
          temperatureC: 3,
          dateReleve: JOUR,
          moment: 'depart',
        });
        annulerReleveTemperature(base, releve.id, 'Premiere annulation.');

        expect(() => annulerReleveTemperature(base, releve.id, 'Deuxieme tentative.')).toThrow(
          ErreurMetier,
        );
        try {
          annulerReleveTemperature(base, releve.id, 'Deuxieme tentative.');
        } catch (erreur) {
          expect((erreur as ErreurMetier).code).toBe('releve_deja_annule');
        }
      });

      it('leve ErreurIntrouvable sur un identifiant inconnu', () => {
        expect(() => annulerReleveTemperature(base, 'inconnu', 'Motif quelconque.')).toThrow(
          ErreurIntrouvable,
        );
      });

      it('les DEUX relevés restent visibles au registre : le mauvais barre, le bon a cote', () => {
        const mauvais = enregistrerReleveTemperature(base, {
          equipement: 'Glacière',
          temperatureC: 12,
          dateReleve: JOUR,
          moment: 'depart',
          actionCorrective: 'Saisie corrigee juste apres — voir le second releve.',
        });
        annulerReleveTemperature(base, mauvais.id, 'Erreur de saisie : 12 au lieu de 2.');

        const bon = enregistrerReleveTemperature(base, {
          equipement: 'Glacière',
          temperatureC: 2,
          dateReleve: JOUR,
          moment: 'depart',
        });

        const tous = listerRelevesTemperature(base);
        expect(tous.some((r) => r.id === mauvais.id && r.statut === 'annulee')).toBe(true);
        expect(tous.some((r) => r.id === bon.id && r.statut === 'active')).toBe(true);
      });

      it('expose le motif et l instant d annulation via listerRelevesTemperature/relevesTemperaturePeriode', () => {
        const releve = enregistrerReleveTemperature(base, {
          equipement: 'Glacière',
          temperatureC: 3,
          dateReleve: JOUR,
          moment: 'depart',
        });
        annulerReleveTemperature(base, releve.id, 'Motif de test pour le registre imprime.');

        for (const lecture of [
          listerRelevesTemperature(base).find((r) => r.id === releve.id),
          relevesTemperaturePeriode(base, JOUR, JOUR).find((r) => r.id === releve.id),
        ]) {
          expect(lecture).toBeDefined();
          expect(lecture!.motifAnnulation).toBe('Motif de test pour le registre imprime.');
          expect(lecture!.dateAnnulation).not.toBeNull();
        }
      });

      it('un releve encore actif n a ni motif ni date d annulation', () => {
        const releve = enregistrerReleveTemperature(base, {
          equipement: 'Glacière',
          temperatureC: 3,
          dateReleve: JOUR,
          moment: 'depart',
        });

        const [lecture] = listerRelevesTemperature(base).filter((r) => r.id === releve.id);
        expect(lecture!.motifAnnulation).toBeNull();
        expect(lecture!.dateAnnulation).toBeNull();
      });
    });

    /**
     * `ecrireReleveTemperature` est le cœur SANS transaction propre, extrait
     * pour que `cloturerSession` (docs/17 fiche 17) le réutilise à l'intérieur
     * de SA transaction. Vérifie que ce cœur, appelé DEPUIS une transaction
     * ambiante (comme le ferait `cloturerSession`), se comporte exactement
     * comme le point d'entrée HTTP autonome : même seuil, même exigence
     * d'action corrective, même ouverture automatique de non-conformité.
     */
    describe('ecrireReleveTemperature — cœur reutilisable depuis une transaction ambiante', () => {
      it('ecrit le releve et ouvre la non-conformite quand elle est appelee dans une transaction', () => {
        const avant = listerNonConformites(base).length;

        const releve = base.transaction((tx) =>
          ecrireReleveTemperature(tx as unknown as BaseBatte, {
            equipement: 'Glacière',
            temperatureC: 9.5,
            dateReleve: JOUR,
            moment: 'retour',
            actionCorrective: 'Ajout de blocs eutectiques.',
          }),
        );

        expect(releve.conforme).toBe(false);
        expect(listerNonConformites(base)).toHaveLength(avant + 1);
      });

      it('refuse toujours un hors-seuil sans action corrective, meme dans une transaction ambiante', () => {
        expect(() =>
          base.transaction((tx) =>
            ecrireReleveTemperature(tx as unknown as BaseBatte, {
              equipement: 'Glacière',
              temperatureC: 9.5,
              dateReleve: JOUR,
              moment: 'retour',
            }),
          ),
        ).toThrow(ErreurMetier);
      });
    });
  });

  /**
   * Défaut corrigé (audit AFSCA du 30/07/2026) : « un registre qui affiche
   * seulement ce qui existe donne une fausse impression de complétude ». Une
   * session clôturée sans aucun relevé rattaché est exactement le trou que
   * cette fonction rend visible.
   */
  describe('sessions sans releve de temperature (le trou doit se voir)', () => {
    it('signale une session cloturee sans aucun releve rattache', () => {
      const session = cloturerSessionAu(JOUR);

      const trous = sessionsSansReleveTemperature(base, JOUR, JOUR);
      expect(trous.some((t) => t.sessionId === session.id)).toBe(true);
    });

    it("ne signale plus la session des qu'un releve lui est rattache", () => {
      const session = cloturerSessionAu(JOUR);
      enregistrerReleveTemperature(base, {
        sessionId: session.id,
        equipement: 'Glacière',
        temperatureC: 4,
        dateReleve: JOUR,
        moment: 'depart',
      });

      const trous = sessionsSansReleveTemperature(base, JOUR, JOUR);
      expect(trous.some((t) => t.sessionId === session.id)).toBe(false);
    });

    /**
     * LE test qui garantit que D-083 ne crée pas d'angle mort réglementaire :
     * un relevé ANNULÉ ne doit plus compter comme un relevé. Une session dont
     * l'UNIQUE relevé a été annulé n'a, EN RÉALITÉ, plus aucun relevé valide —
     * elle doit donc RÉAPPARAÎTRE dans les trous du registre, exactement comme
     * si elle n'en avait jamais eu aucun. Sans ce comportement, « corriger »
     * une donnée en gardant sa fausse valeur dans ce contrôle aurait fait
     * disparaître le trou que l'annulation était censée révéler.
     */
    it("reapparait dans les trous quand l'unique releve d'une session est annule (D-083)", () => {
      const session = cloturerSessionAu(JOUR);
      const releve = enregistrerReleveTemperature(base, {
        sessionId: session.id,
        equipement: 'Glacière',
        temperatureC: 4,
        dateReleve: JOUR,
        moment: 'depart',
      });

      // Le trou est bien comble tant que le releve est actif.
      expect(
        sessionsSansReleveTemperature(base, JOUR, JOUR).some((t) => t.sessionId === session.id),
      ).toBe(false);

      annulerReleveTemperature(base, releve.id, 'Thermometre mal calibre, releve invalide.');

      // Une fois l'unique releve annule, la session n'a PLUS AUCUN releve qui
      // fait foi : elle doit reapparaitre, exactement comme un trou neuf.
      const trous = sessionsSansReleveTemperature(base, JOUR, JOUR);
      expect(trous.some((t) => t.sessionId === session.id)).toBe(true);
    });

    it("ne reapparait plus des qu'un second releve ACTIF rattrape l'annulation", () => {
      const session = cloturerSessionAu(JOUR);
      const releve = enregistrerReleveTemperature(base, {
        sessionId: session.id,
        equipement: 'Glacière',
        temperatureC: 4,
        dateReleve: JOUR,
        moment: 'depart',
      });
      annulerReleveTemperature(base, releve.id, 'Thermometre mal calibre.');

      enregistrerReleveTemperature(base, {
        sessionId: session.id,
        equipement: 'Glacière',
        temperatureC: 3,
        dateReleve: JOUR,
        moment: 'depart',
      });

      const trous = sessionsSansReleveTemperature(base, JOUR, JOUR);
      expect(trous.some((t) => t.sessionId === session.id)).toBe(false);
    });

    it("ignore une session annulee : elle n'a jamais eu lieu commercialement", () => {
      const session = cloturerSessionAu(JOUR);
      annulerSession(base, session.id, 'Test — marché annulé après coup');

      const trous = sessionsSansReleveTemperature(base, JOUR, JOUR);
      expect(trous.some((t) => t.sessionId === session.id)).toBe(false);
    });

    it('ignore une session encore planifiee (pas cloturee) : rien a relever avant le marche', () => {
      const session = creerSession(base, { lieuId: idLieu, dateSession: JOUR });

      const trous = sessionsSansReleveTemperature(base, JOUR, JOUR);
      expect(trous.some((t) => t.sessionId === session.id)).toBe(false);
    });

    it('nomme le numero et le lieu, pour un registre lisible sans jointure supplementaire', () => {
      const session = cloturerSessionAu(JOUR);

      const trous = sessionsSansReleveTemperature(base, JOUR, JOUR);
      const trouve = trous.find((t) => t.sessionId === session.id);
      expect(trouve).toBeDefined();
      expect(trouve!.numero).toBe(session.numero);
      expect(trouve!.lieuNom).not.toBe('');
    });

    it('filtre par periode, bornes incluses', () => {
      cloturerSessionAu('2026-07-10');
      cloturerSessionAu('2026-08-01');

      expect(sessionsSansReleveTemperature(base, '2026-07-01', '2026-07-31')).toHaveLength(1);
    });
  });

  describe('plan de nettoyage', () => {
    it('seedAfsca peuple des taches actives', () => {
      seedAfsca(base);
      const taches = listerTachesNettoyage(base);
      expect(taches.length).toBeGreaterThan(0);
      expect(taches.every((t) => t.actif)).toBe(true);
    });

    it('seedAfsca est idempotent : relance sans doublon', () => {
      // On compare des TOTAUX et non le nombre d'insertions : `seed()` appelle
      // deja `seedAfsca`, donc le premier appel ici n'insere plus rien. C'est
      // le nombre de taches en base qui ne doit pas bouger.
      seedAfsca(base);
      const apresPremier = listerTachesNettoyage(base).length;

      const second = seedAfsca(base);

      expect(second.inseres).toHaveLength(0);
      expect(listerTachesNettoyage(base)).toHaveLength(apresPremier);
      expect(apresPremier).toBeGreaterThan(0);
    });

    it('refuse une execution sur une tache inconnue', () => {
      expect(() =>
        enregistrerExecutionNettoyage(base, {
          tacheId: 'tache-inexistante',
          dateExecution: JOUR,
        }),
      ).toThrow(ErreurIntrouvable);
    });

    it('enregistre une execution et la retrouve avec le libelle de la tache', () => {
      seedAfsca(base);
      const tache = listerTachesNettoyage(base)[0]!;

      enregistrerExecutionNettoyage(base, {
        tacheId: tache.id,
        dateExecution: JOUR,
        executePar: 'Propriétaire',
        observations: 'Rien à signaler.',
      });

      const executions = executionsNettoyagePeriode(base, JOUR, JOUR);
      expect(executions).toHaveLength(1);
      expect(executions[0]!.tacheLibelle).toBe(tache.libelle);
      expect(executions[0]!.zone).toBe(tache.zone);
    });

    it('signale une tache hebdomadaire jamais executee', () => {
      seedAfsca(base);
      const hebdo = listerTachesNettoyage(base).find((t) => t.frequence === 'hebdomadaire')!;

      const retard = tachesEnRetard(base, JOUR);
      expect(retard.some((t) => t.tacheId === hebdo.id)).toBe(true);
      expect(retard.find((t) => t.tacheId === hebdo.id)?.motif).toBe('Jamais exécutée.');
    });

    it('une tache hebdomadaire executee il y a 7 jours n est pas en retard, 8 jours l est', () => {
      seedAfsca(base);
      const hebdo = listerTachesNettoyage(base).find((t) => t.frequence === 'hebdomadaire')!;

      enregistrerExecutionNettoyage(base, { tacheId: hebdo.id, dateExecution: '2026-07-20' });

      // 27/07 - 20/07 = 7 jours : pas encore en retard (delai par defaut 7).
      expect(tachesEnRetard(base, '2026-07-27').some((t) => t.tacheId === hebdo.id)).toBe(false);
      // 28/07 - 20/07 = 8 jours : en retard.
      expect(tachesEnRetard(base, '2026-07-28').some((t) => t.tacheId === hebdo.id)).toBe(true);
    });

    it('une tache apres_session n est en retard que si une session a ete cloturee depuis', () => {
      seedAfsca(base);
      const apresSession = listerTachesNettoyage(base).find(
        (t) => t.frequence === 'apres_session',
      )!;

      // Aucune session cloturee : rien a nettoyer, pas de retard.
      expect(tachesEnRetard(base, JOUR).some((t) => t.tacheId === apresSession.id)).toBe(false);

      cloturerSessionAu('2026-07-26');

      // Une session a eu lieu depuis la derniere (inexistante) execution.
      expect(tachesEnRetard(base, JOUR).some((t) => t.tacheId === apresSession.id)).toBe(true);

      enregistrerExecutionNettoyage(base, {
        tacheId: apresSession.id,
        dateExecution: '2026-07-26',
      });

      // La tache a ete faite depuis : plus de retard.
      expect(tachesEnRetard(base, JOUR).some((t) => t.tacheId === apresSession.id)).toBe(false);
    });
  });

  describe('non-conformites', () => {
    it('declare puis cloture une non-conformite', () => {
      const nc = declarerNonConformite(base, {
        dateConstat: JOUR,
        type: 'Chaîne du froid',
        description: 'Glacière ouverte trop longtemps pendant le transport.',
        gravite: 'mineure',
      });
      expect(nc.dateResolution).toBeNull();

      const cloturee = cloturerNonConformite(base, nc.id, {
        dateResolution: '2026-07-28',
        actionCorrective: 'Ajout d’un second bloc eutectique.',
      });
      expect(cloturee.dateResolution).toBe('2026-07-28');
    });

    it('refuse une cloture sans action corrective', () => {
      const nc = declarerNonConformite(base, {
        dateConstat: JOUR,
        type: 'Chaîne du froid',
        description: 'Test',
        gravite: 'mineure',
      });

      expect(() =>
        cloturerNonConformite(base, nc.id, { dateResolution: JOUR, actionCorrective: '   ' }),
      ).toThrow(ErreurMetier);
    });

    it('refuse de cloturer deux fois — rien ne s efface', () => {
      const nc = declarerNonConformite(base, {
        dateConstat: JOUR,
        type: 'Chaîne du froid',
        description: 'Test',
        gravite: 'majeure',
      });
      cloturerNonConformite(base, nc.id, { dateResolution: JOUR, actionCorrective: 'Corrigé.' });

      expect(() =>
        cloturerNonConformite(base, nc.id, { dateResolution: JOUR, actionCorrective: 'Encore.' }),
      ).toThrow(ErreurMetier);
    });

    it('leve ErreurIntrouvable sur une non-conformite inconnue', () => {
      expect(() =>
        cloturerNonConformite(base, 'inconnue', { dateResolution: JOUR, actionCorrective: 'x' }),
      ).toThrow(ErreurIntrouvable);
    });

    it('liste et filtre par periode', () => {
      declarerNonConformite(base, {
        dateConstat: '2026-07-10',
        type: 'A',
        description: 'a',
        gravite: 'mineure',
      });
      declarerNonConformite(base, {
        dateConstat: '2026-08-01',
        type: 'B',
        description: 'b',
        gravite: 'mineure',
      });

      expect(listerNonConformites(base)).toHaveLength(2);
      expect(nonConformitesPeriode(base, '2026-07-01', '2026-07-31')).toHaveLength(1);
    });
  });

  describe('exercice de tracabilite', () => {
    it('accepte un exercice concluant sans description d ecarts', () => {
      const exercice = enregistrerExerciceTracabilite(base, {
        dateExercice: JOUR,
        resultat: 'concluant',
        dureeMinutes: 45,
      });
      expect(exercice.resultat).toBe('concluant');
      expect(exercice.dureeMinutes).toBe(45);
    });

    it('refuse un exercice non concluant sans ecarts decrits', () => {
      expect(() =>
        enregistrerExerciceTracabilite(base, { dateExercice: JOUR, resultat: 'ecarts' }),
      ).toThrow(ErreurMetier);
    });

    it('accepte un exercice en echec avec ses ecarts decrits, et le liste', () => {
      enregistrerExerciceTracabilite(base, {
        dateExercice: JOUR,
        resultat: 'echec',
        ecartsConstates: 'Impossible de retrouver le lot de beurre sur la fiche.',
      });

      const exercices = listerExercicesTracabilite(base);
      expect(exercices).toHaveLength(1);
      expect(exercices[0]!.resultat).toBe('echec');
    });
  });
});
