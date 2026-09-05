/**
 * Tests d'integration du Lot 7 — reapprovisionnement et cycle de vie des
 * commandes.
 *
 * Critere de fin de docs/04-ROADMAP-LOTS.md : « le stock de farine passe sous
 * le seuil, l'application me propose une commande [...] chez le bon
 * fournisseur, je valide, le mail part. » Le mail lui-meme est teste dans
 * `apps/api` (Lot 7) ; ce fichier couvre le calcul du besoin, le groupement
 * par fournisseur, et la garantie D-009 (aucun saut d'etape brouillon ->
 * envoyee).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  ErreurMetier,
  ajouterJours,
  schemaAnnulationReceptionCreee,
  schemaCommandeDetail,
  schemaListeCommandes,
  schemaReceptionCreee,
} from '@batte/core';
import { and, eq } from 'drizzle-orm';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { seedDemonstration } from '../seed/demonstration.js';
import { conditionnement, ingredient, journalAudit } from '../schema.js';
import { annulerReception, enregistrerReception } from './reception.js';
import { enregistrerSortie } from './mouvements.js';
import { ajouterVersionParametre } from '../depots/parametres.js';
import { listerJournalAudit } from '../depots/audit.js';
import {
  annulerCommande,
  envoiModeTestConnu,
  genererBrouillonsCommandes,
  lireCommandeDetail,
  listerCommandes,
  marquerEnvoyee,
  validerCommande,
  type EnvoiModeTestConnu,
} from './commandes.js';

const JOUR = '2026-07-27';

/**
 * Info d'envoi neutre pour les tests qui ne portent pas sur le mode test
 * lui-même (cycle de vie, boucle d'achat…) : mode test, comme le défaut réel
 * de l'application (`MAIL_MODE_TEST` absent = mode test, `apps/api/src/mail.ts`).
 */
const ENVOI_TEST: EnvoiModeTestConnu = {
  modeTest: true,
  cheminFichierTest: 'sorties/mails/test.txt',
};

describe('Lot 7 — reapprovisionnement et commandes', () => {
  let base: BaseBatte;
  let idFarine: string;
  let idFournisseurDemo: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    idFarine = base
      .select({ id: ingredient.id })
      .from(ingredient)
      .where(eq(ingredient.nom, 'Farine de froment T55'))
      .get()!.id;
    /**
     * DERIVE du conditionnement de la farine, jamais lu « au hasard ».
     *
     * La version precedente prenait `.from(fournisseur).get()` — le premier
     * fournisseur venu, dans l'ordre de lecture de SQLite. Elle a casse le jour
     * ou la graine a insere une autre ligne avant celle-la, sans qu'aucune
     * regle metier n'ait bouge : le test assertait un etat ambiant.
     *
     * Ce que ce test veut reellement dire, c'est « la commande part chez LE
     * FOURNISSEUR DU CONDITIONNEMENT DE REFERENCE de la farine » — exactement
     * la regle qu'applique `genererBrouillonsCommandes`. On lit donc ce lien a
     * la source, au lieu de le dupliquer sous forme de libelle ou de rang.
     */
    idFournisseurDemo = base
      .select({ id: conditionnement.fournisseurId })
      .from(conditionnement)
      .where(eq(conditionnement.ingredientId, idFarine))
      .get()!.id;

    // Fenetre d'historique reduite a 14 jours pour des donnees de test lisibles,
    // au lieu des 90 jours par defaut. Nouvelle VERSION du parametre (date de
    // debut posterieure), jamais un ecrasement : c'est la regle du catalogue.
    ajouterVersionParametre(base, {
      cle: 'reappro_fenetre_historique_jours',
      valeur: '14',
      typeValeur: 'entier',
      dateDebutValidite: '2026-07-01',
      source: 'test',
      description: 'Fenêtre réduite pour les tests.',
    });
  });

  /** Receptionne largement, puis consomme un rythme QUOTIDIEN REGULIER de farine. */
  function construireHistoriqueFarineReguliere(
    quantiteRecue: number,
    quantiteParJour: number,
    nbJours: number,
  ) {
    enregistrerReception(base, {
      fournisseurId: idFournisseurDemo,
      dateReception: '2026-06-01',
      lignes: [
        {
          ingredientId: idFarine,
          quantite: quantiteRecue,
          prixLigneCents: 100,
          numeroLotFournisseur: 'LOT-TEST',
        },
      ],
    });

    for (let i = 0; i < nbJours; i++) {
      const jour = ajouterJours(ajouterJours(JOUR, -(nbJours - 1)), i);
      enregistrerSortie(base, {
        ingredientId: idFarine,
        quantite: quantiteParJour,
        type: 'sortie_production',
        motifCode: 'SURDOSAGE',
        dateMouvement: jour,
      });
    }
  }

  /**
   * Reprojette un `ResultatReception` (forme du SERVICE, `lotsCrees` compris)
   * dans la forme du CONTRAT HTTP `schemaReceptionCreee` (`nbLots` compris) —
   * exactement le mappage que fait `POST /api/receptions`
   * (`apps/api/src/routes/stock.ts`, hors zone d'écriture de ce fichier).
   *
   * Sans ce mappage, `schemaReceptionCreee.parse(resultat)` échoue TOUJOURS
   * sur `nbLots` manquant — ce n'est pas le défaut que ces tests veulent
   * prouver, qui est : « `commandeNumero` traverse bien jusqu'au contrat ».
   */
  function versContratReception(resultat: ReturnType<typeof enregistrerReception>) {
    return {
      receptionId: resultat.receptionId,
      numero: resultat.numero,
      montantTotalCents: resultat.montantTotalCents,
      nbLots: resultat.lotsCrees.length,
      avertissements: resultat.avertissements,
      commandeNumero: resultat.commandeNumero,
    };
  }

  describe('genererBrouillonsCommandes', () => {
    it(
      'critere de fin : farine sous le point de commande -> brouillon groupe ' +
        'chez le bon fournisseur, numerote CF-2026-0001',
      () => {
        // Consommation reguliere de 1000 g/j sur 14 jours (ecart-type nul) et
        // delai fournisseur de 3 j (seed) -> point de commande = 1000*3 = 3000 g.
        // Recu 16 000 g, consomme 14 000 g -> il reste 2000 g, sous le seuil.
        construireHistoriqueFarineReguliere(16_000, 1000, 14);

        const resultat = genererBrouillonsCommandes(base, { jourReference: JOUR });

        expect(resultat.ignores).toEqual([]);
        expect(resultat.commandes).toHaveLength(1);
        const commande = resultat.commandes[0]!;
        expect(commande.numero).toBe('CF-2026-0001');
        expect(commande.fournisseurId).toBe(idFournisseurDemo);
        expect(commande.statut).toBe('brouillon');
        expect(commande.genereAutomatiquement).toBe(true);
        expect(commande.nbLignes).toBe(1);

        const detail = lireCommandeDetail(base, commande.id)!;
        const ligneFarine = detail.lignes.find((l) => l.ingredientId === idFarine)!;
        // Besoin brut 3000 - 2000 = 1000 g -> arrondi au sac de 25 kg -> 1 sac.
        expect(ligneFarine.quantiteConditionnements).toBe(1);
        expect(ligneFarine.quantiteUniteRef).toBe(25_000);
        expect(ligneFarine.conditionnementLibelle).toBe('Sac 25 kg');
        expect(detail.montantTotalCents).toBe(commande.montantTotalCents);
      },
    );

    it('ne propose rien quand le stock disponible couvre deja le point de commande', () => {
      construireHistoriqueFarineReguliere(100_000, 1000, 14);

      const resultat = genererBrouillonsCommandes(base, { jourReference: JOUR });

      expect(resultat.commandes).toHaveLength(0);
      expect(resultat.ignores).toHaveLength(0);
    });

    it(
      "n'engendre PAS de doublon : relancer la generation apres un premier " +
        'brouillon ne cree rien de plus, tant que le brouillon suffit',
      () => {
        construireHistoriqueFarineReguliere(16_000, 1000, 14);

        const premier = genererBrouillonsCommandes(base, { jourReference: JOUR });
        expect(premier.commandes).toHaveLength(1);

        const second = genererBrouillonsCommandes(base, { jourReference: JOUR });
        expect(second.commandes).toHaveLength(0);

        expect(listerCommandes(base)).toHaveLength(1);
      },
    );

    it('ignore un ingredient sans delai de livraison renseigne, avec un motif explicite', () => {
      construireHistoriqueFarineReguliere(16_000, 1000, 14);
      base
        .update(ingredient)
        .set({ delaiLivraisonJours: null })
        .where(eq(ingredient.id, idFarine))
        .run();

      const resultat = genererBrouillonsCommandes(base, { jourReference: JOUR });

      expect(resultat.commandes).toHaveLength(0);
      expect(resultat.ignores).toHaveLength(1);
      expect(resultat.ignores[0]!.ingredientId).toBe(idFarine);
      expect(resultat.ignores[0]!.motif).toContain('Délai de livraison');
    });

    it('ignore un ingredient sans conditionnement actif, avec un motif explicite', () => {
      construireHistoriqueFarineReguliere(16_000, 1000, 14);
      base
        .update(conditionnement)
        .set({ actif: false })
        .where(eq(conditionnement.ingredientId, idFarine))
        .run();

      const resultat = genererBrouillonsCommandes(base, { jourReference: JOUR });

      expect(resultat.commandes).toHaveLength(0);
      expect(resultat.ignores).toHaveLength(1);
      expect(resultat.ignores[0]!.motif).toContain('conditionnement actif');
    });
  });

  describe('cycle de vie — D-009 : aucun envoi sans validation humaine', () => {
    function genererUneCommande(): string {
      construireHistoriqueFarineReguliere(16_000, 1000, 14);
      const resultat = genererBrouillonsCommandes(base, { jourReference: JOUR });
      return resultat.commandes[0]!.id;
    }

    it('brouillon -> validee -> envoyee, dans cet ordre', () => {
      const id = genererUneCommande();

      validerCommande(base, id);
      expect(lireCommandeDetail(base, id)!.statut).toBe('validee');

      marquerEnvoyee(base, id, 'meunier@example.com', ENVOI_TEST);
      const apres = lireCommandeDetail(base, id)!;
      expect(apres.statut).toBe('envoyee');
      expect(apres.emailEnvoyeA).toBe('meunier@example.com');
      expect(apres.dateEnvoi).not.toBeNull();
    });

    it('refuse de sauter directement de brouillon a envoyee', () => {
      const id = genererUneCommande();

      expect(() => marquerEnvoyee(base, id, 'meunier@example.com', ENVOI_TEST)).toThrow(
        ErreurMetier,
      );

      try {
        marquerEnvoyee(base, id, 'meunier@example.com', ENVOI_TEST);
        expect.unreachable('devrait avoir leve une ErreurMetier');
      } catch (erreur) {
        const metier = erreur as ErreurMetier;
        expect(metier.code).toBe('commande_non_validee');
        expect(metier.message).toContain('brouillon');
      }

      // Rien n'a bouge : la commande est toujours en brouillon.
      expect(lireCommandeDetail(base, id)!.statut).toBe('brouillon');
    });

    it('refuse de valider deux fois la meme commande', () => {
      const id = genererUneCommande();
      validerCommande(base, id);

      expect(() => validerCommande(base, id)).toThrow(ErreurMetier);
    });

    it('refuse un envoi sans adresse email', () => {
      const id = genererUneCommande();
      validerCommande(base, id);

      expect(() => marquerEnvoyee(base, id, '', ENVOI_TEST)).toThrow(ErreurMetier);
    });
  });

  /**
   * DÉFAUT TROUVÉ EN AUDIT (29/07/2026) : `annulee` existait dans l'énumération
   * de statut et dans l'affichage de `Achats.tsx`, mais RIEN ne l'écrivait.
   * Une commande brouillon abandonnée restait donc comptée indéfiniment dans
   * `quantiteDejaCommandee`, bloquant tout réapprovisionnement futur pour son
   * ingrédient — même famille de défaut que D-036, côté abandon plutôt que
   * côté réception.
   */
  describe('annulerCommande — corrige le statut mort, referme la boucle d’abandon', () => {
    function genererUneCommande(): string {
      construireHistoriqueFarineReguliere(16_000, 1000, 14);
      const resultat = genererBrouillonsCommandes(base, { jourReference: JOUR });
      return resultat.commandes[0]!.id;
    }

    it('annule un BROUILLON, avec un motif optionnel conservé en note', () => {
      const id = genererUneCommande();

      annulerCommande(base, id, 'Le meunier est en rupture, on décale.');

      const detail = lireCommandeDetail(base, id)!;
      expect(detail.statut).toBe('annulee');
      expect(detail.notes).toBe('Le meunier est en rupture, on décale.');
    });

    it('annule une commande VALIDÉE (pas encore envoyée)', () => {
      const id = genererUneCommande();
      validerCommande(base, id);

      annulerCommande(base, id);

      expect(lireCommandeDetail(base, id)!.statut).toBe('annulee');
    });

    it('refuse d’annuler une commande déjà ENVOYÉE', () => {
      const id = genererUneCommande();
      validerCommande(base, id);
      marquerEnvoyee(base, id, 'meunier@example.test', ENVOI_TEST);

      expect(() => annulerCommande(base, id)).toThrow(ErreurMetier);
      expect(lireCommandeDetail(base, id)!.statut).toBe('envoyee');
    });

    it(
      'LE TEST QUI COMPTE : une commande ANNULÉE ne bloque plus le ' +
        'réapprovisionnement suivant, contrairement à un brouillon abandonné',
      () => {
        const id = genererUneCommande();

        // Avant annulation : la commande brouillon empêche toute reproposition.
        expect(genererBrouillonsCommandes(base, { jourReference: JOUR }).commandes).toHaveLength(0);

        annulerCommande(base, id, 'Abandonnée : quantité revue après comptage.');

        // Après annulation : le besoin réapparaît, exactement comme si la
        // commande n'avait jamais existé (jamais reçue, jamais comptée).
        const second = genererBrouillonsCommandes(base, { jourReference: JOUR });
        expect(second.commandes).toHaveLength(1);
      },
    );

    /**
     * TROU 5 (audit du 30/07/2026) : sur la vraie base, `journal_audit` est à
     * ZÉRO ligne. Vérifié par lecture directe de `donnees/batte.sqlite` en
     * lecture seule : aucune quarantaine de lot, aucune contrepassation,
     * aucune commande ni production ANNULÉE n'a jamais eu lieu — donc zéro
     * ligne est le résultat ATTENDU, pas un mécanisme cassé. Mais la lecture
     * du code a trouvé un vrai défaut LATENT : `annulerCommande` écrivait déjà
     * le changement de statut sans jamais appeler `journaliser`, contrairement
     * à `annulerProduction` qui trace la même famille de geste. Ce test
     * prouve que l'action corrective écrit désormais bien au journal — il
     * aurait échoué avant la correction ci-dessus.
     */
    it('écrit une entrée au journal d’audit pour la DÉCISION d’annuler (Trou 5)', () => {
      const id = genererUneCommande();
      expect(listerJournalAudit(base, { table: 'commande_fournisseur' })).toHaveLength(0);

      annulerCommande(base, id, 'Le meunier est en rupture, on décale.');

      const traces = listerJournalAudit(base, {
        table: 'commande_fournisseur',
        enregistrementId: id,
      });
      expect(traces).toHaveLength(1);
      expect(traces[0]?.action).toBe('annulation');
      expect(traces[0]?.valeurAvant?.statut).toBe('brouillon');
      expect(traces[0]?.valeurApres?.statut).toBe('annulee');
      expect(traces[0]?.valeurApres?.notes).toBe('Le meunier est en rupture, on décale.');
    });

    it(
      'n’ajoute AUCUNE entrée au-delà de celle de l’envoi lui-même, quand ' +
        'l’annulation est refusée (commande déjà envoyée)',
      () => {
        const id = genererUneCommande();
        validerCommande(base, id);
        marquerEnvoyee(base, id, 'meunier@example.test', ENVOI_TEST);

        // `marquerEnvoyee` journalise désormais LÉGITIMEMENT l'envoi lui-même
        // (mission « le seul piège silencieux qui reste », 01/08/2026 — voir
        // le describe dédié plus bas, `envoiModeTestConnu`) : le compte de
        // référence est donc 1, pas 0, AVANT même la tentative d'annulation
        // refusée ci-dessous. Avant ce correctif, `marquerEnvoyee` n'écrivait
        // rien au journal — c'est ce qui rendait ce test vrai avec un compte
        // à 0 ; ce n'est plus le bon invariant à vérifier.
        const avant = listerJournalAudit(base, {
          table: 'commande_fournisseur',
          enregistrementId: id,
        });
        expect(avant).toHaveLength(1);
        expect(avant[0]?.action).toBe('modification');

        expect(() => annulerCommande(base, id)).toThrow(ErreurMetier);

        // LE TEST QUI COMPTE : la tentative REFUSÉE n'ajoute rien de plus —
        // toujours exactement l'entrée de l'envoi, aucune trace 'annulation'
        // fantôme pour une action qui a échoué.
        const apres = listerJournalAudit(base, {
          table: 'commande_fournisseur',
          enregistrementId: id,
        });
        expect(apres).toHaveLength(1);
        expect(apres[0]?.action).toBe('modification');
      },
    );
  });

  /**
   * MISSION « LE SEUL PIÈGE SILENCIEUX QUI RESTE » (01/08/2026, docs/33 §2.d
   * confirme le défaut encore ouvert au moment de cette mission) : le mode
   * d'envoi (test ou réel) n'était connu que le temps de la réponse HTTP de
   * `POST /commandes/:id/envoyer` — jamais persisté. Rouvrir la même
   * commande après un rechargement de page la montrait comme un envoi RÉEL,
   * qu'il l'ait été ou non. `marquerEnvoyee` persiste désormais ce fait au
   * journal d'audit (aucune colonne dédiée — hors zone d'écriture de cette
   * mission, `packages/db/src/schema.ts`), et `envoiModeTestConnu` /
   * `lireCommandeDetail` le relisent, INDÉPENDAMMENT de l'appel qui a envoyé.
   */
  describe('envoiModeTestConnu — le fait « ce mail-là est-il parti ? » survit à un rechargement', () => {
    function genererUneCommande(): string {
      construireHistoriqueFarineReguliere(16_000, 1000, 14);
      const resultat = genererBrouillonsCommandes(base, { jourReference: JOUR });
      return resultat.commandes[0]!.id;
    }

    it("rend `null` AVANT tout envoi : le fait n'existe simplement pas encore", () => {
      const id = genererUneCommande();
      expect(envoiModeTestConnu(base, id)).toBeNull();
      expect(lireCommandeDetail(base, id)!.envoiModeTest).toBeNull();
      expect(lireCommandeDetail(base, id)!.cheminFichierTest).toBeNull();
    });

    it(
      'persiste un envoi en MODE TEST : retrouvé identiquement par une lecture ' +
        'ULTÉRIEURE et INDÉPENDANTE — exactement ce qui se passe après un ' +
        'rechargement de page côté écran',
      () => {
        const id = genererUneCommande();
        validerCommande(base, id);
        marquerEnvoyee(base, id, 'meunier@example.test', {
          modeTest: true,
          cheminFichierTest: 'sorties/mails/mail_test.txt',
        });

        expect(envoiModeTestConnu(base, id)).toEqual({
          modeTest: true,
          cheminFichierTest: 'sorties/mails/mail_test.txt',
        });
        const detail = lireCommandeDetail(base, id)!;
        expect(detail.envoiModeTest).toBe(true);
        expect(detail.cheminFichierTest).toBe('sorties/mails/mail_test.txt');
      },
    );

    it('persiste un envoi RÉEL : `envoiModeTest` retrouvé à `false`, jamais `null`', () => {
      const id = genererUneCommande();
      validerCommande(base, id);
      marquerEnvoyee(base, id, 'meunier@example.test', {
        modeTest: false,
        cheminFichierTest: null,
      });

      expect(envoiModeTestConnu(base, id)).toEqual({ modeTest: false, cheminFichierTest: null });
      const detail = lireCommandeDetail(base, id)!;
      expect(detail.envoiModeTest).toBe(false);
      expect(detail.cheminFichierTest).toBeNull();
    });

    it(
      'LE CAS QUE LA MISSION DÉCRIT : une commande envoyée AVANT ce correctif ' +
        "n'a pas cette annotation au journal — le fait reste `null`, JAMAIS " +
        'deviné `false` (CLAUDE.md, doctrine « une valeur inconnue vaut `null`, ' +
        'jamais `false` »), et la commande reste pourtant bien lisible comme ' +
        'ENVOYÉE : seul le MODE est inconnu, pas le fait même de l’envoi',
      () => {
        const id = genererUneCommande();
        validerCommande(base, id);
        marquerEnvoyee(base, id, 'meunier@example.test', ENVOI_TEST);

        // Simule une commande envoyée par l'ANCIEN mécanisme (avant ce
        // correctif) : son entrée d'audit existe (la bascule de statut a
        // bien été journalisée), mais sans les deux clés que seule la
        // nouvelle version de `marquerEnvoyee` ajoute.
        const [entree] = listerJournalAudit(base, {
          table: 'commande_fournisseur',
          enregistrementId: id,
        });
        if (entree === undefined || entree.valeurApres === null) {
          throw new Error('Entrée d’audit introuvable : le test ne peut pas continuer.');
        }
        const valeursSansAnnotation = Object.fromEntries(
          Object.entries(entree.valeurApres).filter(
            ([cle]) => cle !== 'envoiModeTest' && cle !== 'envoiCheminFichierTest',
          ),
        );
        base
          .update(journalAudit)
          .set({ valeursApres: valeursSansAnnotation })
          .where(eq(journalAudit.id, entree.id))
          .run();

        expect(envoiModeTestConnu(base, id)).toBeNull();
        const detail = lireCommandeDetail(base, id)!;
        expect(detail.envoiModeTest).toBeNull();
        expect(detail.cheminFichierTest).toBeNull();
        expect(detail.statut).toBe('envoyee');
      },
    );
  });

  describe('lecture', () => {
    it('liste et detaille les commandes', () => {
      construireHistoriqueFarineReguliere(16_000, 1000, 14);
      genererBrouillonsCommandes(base, { jourReference: JOUR });

      const liste = listerCommandes(base);
      expect(liste).toHaveLength(1);

      const detail = lireCommandeDetail(base, liste[0]!.id);
      expect(detail).not.toBeNull();
      expect(detail!.lignes.length).toBeGreaterThan(0);
    });

    it('rend null pour une commande inexistante', () => {
      expect(lireCommandeDetail(base, 'introuvable')).toBeNull();
    });
  });

  /**
   * LA BOUCLE D'ACHAT (D-036).
   *
   * Sans rattachement reception -> commande, `quantiteDejaCommandee` comptait
   * eternellement la marchandise « en route ». Le stock projete gonflait donc a
   * chaque commande, et le moteur finissait par ne plus rien proposer : rupture
   * un samedi soir, sans aucune alerte.
   */
  describe('boucle d achat : la reception solde la commande', () => {
    it('une commande recue cesse de bloquer les reapprovisionnements suivants', () => {
      // 16 000 recus - 14 000 consommes = 2000 g, sous le point de commande
      // de 3000 g : le moteur propose.
      construireHistoriqueFarineReguliere(16_000, 1000, 14);

      const premier = genererBrouillonsCommandes(base, { jourReference: JOUR });
      expect(premier.commandes).toHaveLength(1);
      const commandeId = premier.commandes[0]!.id;
      validerCommande(base, commandeId);
      marquerEnvoyee(base, commandeId, 'meunier@example.test', ENVOI_TEST);

      // Tant que la marchandise est EN ROUTE, ne rien reproposer est correct.
      expect(genererBrouillonsCommandes(base, { jourReference: JOUR }).commandes).toHaveLength(0);

      // Elle arrive, rattachee a SA commande : c'est ce changement d'etat qui
      // la sort du stock projete.
      enregistrerReception(base, {
        fournisseurId: idFournisseurDemo,
        dateReception: JOUR,
        commandeId,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 25_000,
            prixLigneCents: 1875,
            numeroLotFournisseur: 'LOT-TEST',
          },
        ],
      });
      expect(lireCommandeDetail(base, commandeId)!.statut).toBe('recue');

      // On consomme tout le nouveau stock : le besoin reapparait.
      enregistrerSortie(base, {
        ingredientId: idFarine,
        quantite: 26_000,
        type: 'sortie_production',
        motifCode: 'SURDOSAGE',
        dateMouvement: JOUR,
      });

      // LE TEST QUI COMPTE : avant D-036, la quantite de la commande soldee
      // etait comptee « en route » a vie, le stock projete restait artificiel-
      // lement haut et le moteur ne proposait plus JAMAIS rien.
      const second = genererBrouillonsCommandes(base, { jourReference: JOUR });
      expect(second.commandes).toHaveLength(1);
    });

    it('refuse de rattacher deux receptions a la meme commande', () => {
      construireHistoriqueFarineReguliere(16_000, 1000, 14);
      const commandeId = genererBrouillonsCommandes(base, { jourReference: JOUR }).commandes[0]!.id;
      validerCommande(base, commandeId);
      marquerEnvoyee(base, commandeId, 'meunier@example.test', ENVOI_TEST);

      enregistrerReception(base, {
        fournisseurId: idFournisseurDemo,
        dateReception: JOUR,
        commandeId,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 25_000,
            prixLigneCents: 1875,
            numeroLotFournisseur: 'LOT-TEST',
          },
        ],
      });

      // Deux receptions sur une meme commande feraient disparaitre sa quantite
      // du stock projete deux fois.
      expect(() =>
        enregistrerReception(base, {
          fournisseurId: idFournisseurDemo,
          dateReception: JOUR,
          commandeId,
          lignes: [
            {
              ingredientId: idFarine,
              quantite: 25_000,
              prixLigneCents: 1875,
              numeroLotFournisseur: 'LOT-TEST',
            },
          ],
        }),
      ).toThrow(ErreurMetier);
    });

    it('refuse une commande inexistante', () => {
      expect(() =>
        enregistrerReception(base, {
          fournisseurId: idFournisseurDemo,
          dateReception: JOUR,
          commandeId: 'commande-qui-nexiste-pas',
          lignes: [
            {
              ingredientId: idFarine,
              quantite: 1000,
              prixLigneCents: 100,
              numeroLotFournisseur: 'LOT-TEST',
            },
          ],
        }),
      ).toThrow(ErreurMetier);
    });

    it('une reception SANS commande reste possible : tout achat ne passe pas par un bon', () => {
      const resultat = enregistrerReception(base, {
        fournisseurId: idFournisseurDemo,
        dateReception: JOUR,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 1000,
            prixLigneCents: 100,
            numeroLotFournisseur: 'LOT-TEST',
          },
        ],
      });

      // `commandeNumero` (mission « boucle d'achat », 30/07/2026) : `null`,
      // jamais une chaîne vide inventée, quand aucune commande n'est rattachée.
      expect(resultat.commandeNumero).toBeNull();
      expect(() => schemaReceptionCreee.parse(versContratReception(resultat))).not.toThrow();
    });
  });

  /**
   * AUDIT DU 30/07/2026 — `reception.commandeId` : écrite à l'enregistrement
   * d'une réception (`enregistrerReception`), utilisée SEULEMENT comme
   * paramètre d'entrée pour solder la commande au moment même de l'écriture —
   * jamais reprojetée depuis la table ensuite. Referme la boucle d'achat dans
   * le sens commande -> réception : `lireCommandeDetail`/`listerCommandes`
   * relisent désormais cette colonne (`receptionsRecentesParCommande`,
   * `receptionsLieesACommande` ci-dessus dans `services/commandes.ts`).
   */
  describe('reception.commandeId reprojetee : commande -> reception(s)', () => {
    function genererEtEnvoyerUneCommande(): string {
      construireHistoriqueFarineReguliere(16_000, 1000, 14);
      const commandeId = genererBrouillonsCommandes(base, { jourReference: JOUR }).commandes[0]!.id;
      validerCommande(base, commandeId);
      marquerEnvoyee(base, commandeId, 'meunier@example.test', ENVOI_TEST);
      return commandeId;
    }

    it('lireCommandeDetail expose la reception qui a solde la commande', () => {
      const commandeId = genererEtEnvoyerUneCommande();
      const resultatReception = enregistrerReception(base, {
        fournisseurId: idFournisseurDemo,
        dateReception: JOUR,
        commandeId,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 25_000,
            prixLigneCents: 1875,
            numeroLotFournisseur: 'LOT-TEST',
          },
        ],
      });

      const detail = lireCommandeDetail(base, commandeId)!;
      expect(detail.receptionsLiees).toHaveLength(1);
      expect(detail.receptionsLiees[0]!.id).toBe(resultatReception.receptionId);
      expect(detail.receptionsLiees[0]!.numero).toBe(resultatReception.numero);
      expect(detail.receptionsLiees[0]!.statut).toBe('active');

      // « Voir laquelle » côté écriture (mission « boucle d'achat »,
      // 30/07/2026) : la réponse de `enregistrerReception` redit elle-même le
      // numéro de la commande qu'elle vient de solder.
      expect(resultatReception.commandeNumero).toBe(detail.numero);
      expect(() =>
        schemaReceptionCreee.parse(versContratReception(resultatReception)),
      ).not.toThrow();
    });

    it('listerCommandes expose le numero et le statut de cette meme reception', () => {
      const commandeId = genererEtEnvoyerUneCommande();
      const resultatReception = enregistrerReception(base, {
        fournisseurId: idFournisseurDemo,
        dateReception: JOUR,
        commandeId,
        lignes: [
          {
            ingredientId: idFarine,
            quantite: 25_000,
            prixLigneCents: 1875,
            numeroLotFournisseur: 'LOT-TEST',
          },
        ],
      });

      const ligne = listerCommandes(base).find((c) => c.id === commandeId)!;
      expect(ligne.receptionNumero).toBe(resultatReception.numero);
      expect(ligne.receptionStatut).toBe('active');
    });

    it('une commande sans reception encore rattachee expose receptionNumero/receptionStatut a null', () => {
      construireHistoriqueFarineReguliere(16_000, 1000, 14);
      const commandeId = genererBrouillonsCommandes(base, { jourReference: JOUR }).commandes[0]!.id;

      const detail = lireCommandeDetail(base, commandeId)!;
      expect(detail.receptionsLiees).toEqual([]);

      const ligne = listerCommandes(base).find((c) => c.id === commandeId)!;
      expect(ligne.receptionNumero).toBeNull();
      expect(ligne.receptionStatut).toBeNull();
    });

    /**
     * DÉFAUT MÉTIER CORRIGÉ (mission « boucle d'achat », 30/07/2026) :
     * `annulerReception` contrepassait déjà le stock mais NE REVENAIT JAMAIS
     * sur le statut `recue` de la commande qu'elle avait soldée. Une commande
     * pouvait donc s'afficher « reçue » alors que la marchandise était
     * intégralement repartie.
     *
     * `enregistrerReception` journalise désormais le statut antérieur à
     * CHAQUE bascule vers `recue` (voir son commentaire de fonction) :
     * `annulerReception` le retrouve ici avec CERTITUDE (le cycle complet
     * `validee -> envoyee` a été suivi juste avant, via
     * `genererEtEnvoyerUneCommande`) et restaure ce statut exact — jamais un
     * statut deviné.
     */
    it(
      'annulerReception restaure le statut ANTÉRIEUR de la commande quand il est ' +
        'retrouvé avec certitude au journal d’audit',
      () => {
        const commandeId = genererEtEnvoyerUneCommande();
        const resultatReception = enregistrerReception(base, {
          fournisseurId: idFournisseurDemo,
          dateReception: JOUR,
          commandeId,
          lignes: [
            {
              ingredientId: idFarine,
              quantite: 25_000,
              prixLigneCents: 1875,
              numeroLotFournisseur: 'LOT-TEST',
            },
          ],
        });

        const annulation = annulerReception(base, resultatReception.receptionId, 'ERREUR_SAISIE');
        expect(() => schemaAnnulationReceptionCreee.parse(annulation)).not.toThrow();
        expect(annulation.commandeId).toBe(commandeId);
        // `genererEtEnvoyerUneCommande` amène la commande jusqu'à `envoyee`
        // juste avant la réception : c'est CE statut qui doit revenir.
        expect(annulation.commandeStatutRestaure).toBe('envoyee');

        const detail = lireCommandeDetail(base, commandeId)!;
        expect(detail.statut).toBe('envoyee');
        // La réception, elle, reste bien annulée : seul le statut de la
        // COMMANDE est corrigé, pas l'historique de la réception elle-même.
        expect(detail.receptionsLiees).toHaveLength(1);
        expect(detail.receptionsLiees[0]!.statut).toBe('annulee');

        const ligne = listerCommandes(base).find((c) => c.id === commandeId)!;
        expect(ligne.statut).toBe('envoyee');
        expect(ligne.receptionStatut).toBe('annulee');

        // La correction est une ÉCRITURE NOUVELLE, permanente (CLAUDE.md §3
        // règle 7) : elle laisse une trace lisible sur la commande elle-même,
        // pas seulement un calcul de lecture.
        expect(detail.notes).toContain(resultatReception.numero);

        // ET une entrée d'audit distincte de celle qui avait marqué `recue` :
        // rien n'est réécrit, une nouvelle ligne s'ajoute.
        const entreesAudit = listerJournalAudit(base, {
          table: 'commande_fournisseur',
          enregistrementId: commandeId,
        });
        expect(entreesAudit.length).toBeGreaterThanOrEqual(2);
        expect(entreesAudit[0]!.valeurApres?.['statut']).toBe('envoyee');
      },
    );

    /**
     * LE PIÈGE EXPLICITEMENT SIGNALÉ PAR LA MISSION : une commande peut avoir
     * PLUSIEURS réceptions. Annuler l'une d'elles ne veut pas dire que la
     * commande n'a rien reçu — et ici, la commande enchaîne deux cycles
     * complets « reçue -> annulée -> ouverte -> reçue à nouveau ».
     */
    it(
      'une commande à PLUSIEURS réceptions : chaque annulation restaure SON PROPRE ' +
        'statut antérieur, jamais celui d’un cycle précédent',
      () => {
        const commandeId = genererEtEnvoyerUneCommande();

        // Cycle 1 : premiere reception, solde la commande.
        const receptionA = enregistrerReception(base, {
          fournisseurId: idFournisseurDemo,
          dateReception: JOUR,
          commandeId,
          lignes: [
            {
              ingredientId: idFarine,
              quantite: 25_000,
              prixLigneCents: 1875,
              numeroLotFournisseur: 'LOT-CYCLE-A',
            },
          ],
        });
        expect(lireCommandeDetail(base, commandeId)!.statut).toBe('recue');

        const annulationA = annulerReception(base, receptionA.receptionId, 'ERREUR_SAISIE');
        expect(annulationA.commandeStatutRestaure).toBe('envoyee');
        expect(lireCommandeDetail(base, commandeId)!.statut).toBe('envoyee');

        // La commande est de nouveau OUVERTE : une SECONDE réception peut donc
        // s'y rattacher — c'est exactement ce que `commande_deja_soldee`
        // interdisait pendant que la première réception restait active.
        const receptionB = enregistrerReception(base, {
          fournisseurId: idFournisseurDemo,
          dateReception: JOUR,
          commandeId,
          lignes: [
            {
              ingredientId: idFarine,
              quantite: 25_000,
              prixLigneCents: 1875,
              numeroLotFournisseur: 'LOT-CYCLE-B',
            },
          ],
        });
        expect(lireCommandeDetail(base, commandeId)!.statut).toBe('recue');

        // Cycle 2 : annuler CETTE seconde réception doit encore retrouver
        // « envoyee » — pas rester bloqué sur l'entrée d'audit du cycle 1.
        const annulationB = annulerReception(base, receptionB.receptionId, 'ERREUR_SAISIE');
        expect(annulationB.commandeStatutRestaure).toBe('envoyee');

        const detail = lireCommandeDetail(base, commandeId)!;
        expect(detail.statut).toBe('envoyee');
        expect(detail.receptionsLiees).toHaveLength(2);
        expect(detail.receptionsLiees.every((r) => r.statut === 'annulee')).toBe(true);
      },
    );

    /**
     * LE CAS OÙ ON NE PEUT PAS SAVOIR : une réception qui a soldé une commande
     * SANS que la bascule ait été journalisée (donnée antérieure au correctif
     * du 30/07/2026, simulée ici en retirant l'entrée d'audit après coup).
     * CLAUDE.md §7 : une valeur inconnue vaut `null`, jamais une valeur par
     * défaut plausible — `annulerReception` ne doit RIEN deviner.
     */
    it(
      "quand le statut antérieur n'est pas retrouvable, rien n'est deviné : la " +
        'commande reste "recue", et l’incohérence est rendue explicite et ' +
        'PERMANENTE dans `notes`',
      () => {
        const commandeId = genererEtEnvoyerUneCommande();
        const resultatReception = enregistrerReception(base, {
          fournisseurId: idFournisseurDemo,
          dateReception: JOUR,
          commandeId,
          lignes: [
            {
              ingredientId: idFarine,
              quantite: 25_000,
              prixLigneCents: 1875,
              numeroLotFournisseur: 'LOT-TEST',
            },
          ],
        });

        // Simule un historique incomplet : l'entrée d'audit qui aurait permis
        // de retrouver le statut antérieur n'existe pas.
        base
          .delete(journalAudit)
          .where(
            and(
              eq(journalAudit.tableCible, 'commande_fournisseur'),
              eq(journalAudit.enregistrementId, commandeId),
            ),
          )
          .run();

        const annulation = annulerReception(base, resultatReception.receptionId, 'ERREUR_SAISIE');
        expect(() => schemaAnnulationReceptionCreee.parse(annulation)).not.toThrow();

        // Aucune valeur devinée : `null`, jamais un statut plausible.
        expect(annulation.commandeStatutRestaure).toBeNull();

        const detail = lireCommandeDetail(base, commandeId)!;
        expect(detail.statut).toBe('recue');

        // L'incohérence est écrite en DUR dans la commande — permanente, pas
        // seulement un calcul de lecture (`receptionStatut`).
        expect(detail.notes).toContain(resultatReception.numero);
        expect(detail.notes).toMatch(/n'a pas pu être retrouvé/);

        // Et journalisée comme toute modification de commande (règle n°7).
        const entreesAudit = listerJournalAudit(base, {
          table: 'commande_fournisseur',
          enregistrementId: commandeId,
        });
        expect(entreesAudit.length).toBeGreaterThanOrEqual(1);
        expect(entreesAudit[0]!.valeurApres?.['statut']).toBe('recue');
      },
    );
  });

  /**
   * RÉGRESSION RÉELLE, trouvée et corrigée pendant cette même mission :
   * `lireCommandeDetail` renvoyait `receptionsLiees` mais PAS
   * `receptionNumero`/`receptionStatut` — deux champs hérités par
   * `schemaCommandeDetail` de `schemaCommandeResume` (`.extend(...)`,
   * `packages/core/src/contrats/commandes.ts`). Comme `lireCommandeDetail`
   * n'a pas de type de retour explicite, `tsc` ne voyait rien : seul
   * `schemaCommandeDetail.parse(...)`, appelé par CHAQUE route qui rend le
   * détail d'une commande (générer, valider, annuler, envoyer), levait une
   * `ZodError` — traduite en 422 par le gestionnaire d'erreurs commun. Toute
   * commande fraîchement générée (donc SANS AUCUNE réception rattachée —
   * c'est la norme : la réception vient toujours APRÈS) faisait donc échouer
   * `POST /commandes/:id/valider` et `POST /commandes/:id/envoyer` en HTTP,
   * alors que les tests de service de ce même fichier ne l'ont jamais vu :
   * ils n'appellent jamais `schemaCommandeDetail.parse`.
   *
   * Ce test rejoue exactement ce cycle de vie (générer -> valider -> envoyer,
   * SANS réception à aucune étape) et fait passer chaque étape par le contrat
   * Zod réel, pas seulement par le type TypeScript inféré : c'est la seule
   * façon de reproduire cette classe de régression dans `packages/db`, avant
   * qu'elle n'atteigne les tests HTTP (`apps/api/src/routes/*.test.ts`, hors
   * zone d'écriture de cette mission).
   */
  describe(
    'régression : une commande jamais rattachée à aucune réception reste validable ' +
      'et envoyable, et son détail respecte schemaCommandeDetail',
    () => {
      it('generer -> valider -> envoyer, sans reception a aucune etape', () => {
        construireHistoriqueFarineReguliere(16_000, 1000, 14);
        const resultatGeneration = genererBrouillonsCommandes(base, { jourReference: JOUR });
        expect(resultatGeneration.commandes).toHaveLength(1);
        const commandeId = resultatGeneration.commandes[0]!.id;

        // `listerCommandes` (résumé) respecte déjà `schemaListeCommandes` au
        // stade brouillon, sans aucune réception.
        expect(() =>
          schemaListeCommandes.parse({
            data: listerCommandes(base),
            meta: { total: listerCommandes(base).length },
          }),
        ).not.toThrow();

        const detailBrouillon = lireCommandeDetail(base, commandeId)!;
        expect(() => schemaCommandeDetail.parse(detailBrouillon)).not.toThrow();
        expect(detailBrouillon.receptionNumero).toBeNull();
        expect(detailBrouillon.receptionStatut).toBeNull();
        expect(detailBrouillon.receptionsLiees).toEqual([]);

        validerCommande(base, commandeId);
        const detailValidee = lireCommandeDetail(base, commandeId)!;
        expect(() => schemaCommandeDetail.parse(detailValidee)).not.toThrow();
        expect(detailValidee.statut).toBe('validee');

        marquerEnvoyee(base, commandeId, 'meunier@example.test', ENVOI_TEST);
        const detailEnvoyee = lireCommandeDetail(base, commandeId)!;
        expect(() => schemaCommandeDetail.parse(detailEnvoyee)).not.toThrow();
        expect(detailEnvoyee.statut).toBe('envoyee');
        // Toujours aucune réception : elle n'arrive qu'après l'envoi, pas
        // avant — ce test couvre précisément l'invariant cassé par la
        // régression.
        expect(detailEnvoyee.receptionNumero).toBeNull();
        expect(detailEnvoyee.receptionsLiees).toEqual([]);
      });
    },
  );
});
