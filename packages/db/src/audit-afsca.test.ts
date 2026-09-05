/**
 * Audit ciblé — registre AFSCA et traçabilité (mission dédiée, 29/07/2026).
 *
 * CE FICHIER A CHANGÉ DE NATURE EN COURS DE MISSION. Une première passe a
 * trouvé trois défauts touchant des fichiers hors de la zone d'écriture de
 * l'époque, et les avait encodés en `it.fails` (« le test affirme le
 * comportement CORRECT ; il échoue aujourd'hui parce que le défaut existe
 * encore ») pour qu'ils ne se perdent pas dans un rapport d'audit qu'on ne
 * relit jamais. Une seconde passe, celle-ci avec les trois fichiers concernés
 * dans sa zone d'écriture, les a CORRIGÉS :
 *
 *  1. `changerStatutLot` (`packages/db/src/services/mouvements.ts`) ouvre
 *     désormais une non-conformité pour les motifs qui traduisent un
 *     incident sanitaire — voir `motifOuvreNonConformite` dans ce fichier
 *     pour la liste retenue et sa justification.
 *  2. `tracabiliteAvalLot` (`packages/db/src/depots/tracabilite.ts`) porte
 *     désormais un champ `nonConformites`, déclaré au contrat
 *     (`packages/core/src/contrats/afsca.ts`) et affiché
 *     (`apps/web/src/pages/RegistreAfsca.tsx`).
 *  3. `TABLES_PROTEGEES` (`packages/db/src/non-suppression-historique.test.ts`)
 *     couvre désormais les sept tables réglementaires du registre AFSCA, en
 *     plus des quatre tables RGPD déjà couvertes.
 *
 * Les trois `it.fails` ont donc été **retournés en tests de non-régression**
 * (leur assertion ne change pas — c'est le même comportement qu'on continue
 * d'exiger — seul `.fails` disparaît). Ne pas les supprimer ni les
 * redésactiver : c'est exactement le geste que la convention `it.fails`
 * cherche à empêcher qu'on oublie de faire.
 *
 * Ce fichier garde malgré tout ses deux `describe` de haut niveau, pour la
 * même raison qu'au départ :
 *
 *  1. RÉGRESSION — les corrections apportées PENDANT la première passe de cet
 *     audit (`packages/db/src/depots/tracabilite.ts` — recherche par numéro
 *     de lot fournisseur, `apps/api/src/routes/afsca.ts`). Des tests normaux.
 *
 *  2. DÉFAUTS CORRIGÉS PENDANT LA SECONDE PASSE — ex-`it.fails`, désormais des
 *     tests de non-régression ordinaires. Le commentaire au-dessus de chacun
 *     garde la trace du défaut d'origine : c'est la mémoire de ce qui aurait
 *     pu se reproduire silencieusement.
 */

import { describe, expect, it } from 'vitest';
import { ErreurIntrouvable, ErreurMetier } from '@batte/core';
import { creerBase, type BaseBatte } from './client.js';
import { migrer } from './migrer.js';
import { seed } from './seed/index.js';
import { seedDemonstration } from './seed/demonstration.js';
import { fournisseur, ingredient } from './schema.js';
import { enregistrerReception } from './services/reception.js';
import { changerStatutLot } from './services/mouvements.js';
import { declarerNonConformite, listerNonConformites } from './services/afsca.js';
import { tracabiliteAvalLot } from './depots/tracabilite.js';
import { suppressionsDangereuses } from './non-suppression-historique.test.js';

const JOUR = '2026-07-27';

function preparerBase(): { base: BaseBatte; idFournisseur: string; ingredients: string[] } {
  const base = creerBase(':memory:');
  migrer(base);
  seed(base);
  seedDemonstration(base);
  const idFournisseur = base.select({ id: fournisseur.id }).from(fournisseur).get()!.id;
  const ingredients = base
    .select({ id: ingredient.id })
    .from(ingredient)
    .all()
    .map((i) => i.id);
  return { base, idFournisseur, ingredients };
}

/** Reçoit UN ingrédient, avec un numéro de lot fournisseur choisi par le test. */
function recevoirUnLot(
  base: BaseBatte,
  fournisseurId: string,
  ingredientId: string,
  numeroLotFournisseur: string | null,
): string {
  const resultat = enregistrerReception(base, {
    fournisseurId,
    dateReception: JOUR,
    lignes: [
      {
        ingredientId,
        quantite: 5_000,
        prixLigneCents: 1_000,
        numeroLotFournisseur,
        dateDlc: '2027-01-01',
      },
    ],
  });
  return resultat.lotsCrees[0]!.lotId;
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. RÉGRESSION — recherche de traçabilité aval par numéro de lot fournisseur
   ═══════════════════════════════════════════════════════════════════════════

   Défaut trouvé : `GET /afsca/tracabilite/lots/:id` (donc `tracabiliteAvalLot`)
   n'acceptait QUE l'identifiant technique du lot (`lot.id`, un ULID). Or cet
   identifiant n'est affiché NULLE PART dans l'application — ni `Stock.tsx`, ni
   `DetailLot.tsx` ne le montraient avant cet audit — alors que l'avis de
   rappel d'un fournisseur porte SON numéro de lot. Vérifié en lisant
   `apps/web/src/pages/Stock.tsx` (`colonnesLots`) et l'ancien
   `DetailLot.tsx` : aucune des deux ne rendait `lot.id` en texte, seulement
   `numeroLotFournisseur`. La recherche « Aval », pourtant le cœur de la
   réponse à « ce lot est rappelé, où est-il parti ? », était donc
   IRRÉALISABLE en pratique lors d'un rappel réel.

   Corrigé dans `packages/db/src/depots/tracabilite.ts`
   (`resoudreLotId`) : l'identifiant technique reste tenté en premier (aucune
   régression), puis repli sur le numéro fournisseur ; ambiguïté explicite
   plutôt qu'un choix arbitraire si plusieurs lots partagent ce numéro. Le
   champ « Identifiant technique » a aussi été rendu visible dans
   `DetailLot.tsx`, en repli, pour lever l'ambiguïté au cas où elle survienne. */
describe('Traçabilité aval — recherche par numéro de lot fournisseur (correction apportée)', () => {
  it("retrouve le lot par son numéro fournisseur quand l'identifiant technique n'est pas connu", () => {
    const { base, idFournisseur, ingredients } = preparerBase();
    const lotId = recevoirUnLot(base, idFournisseur, ingredients[0]!, 'RAPPEL-2026-042');

    const resultat = tracabiliteAvalLot(base, 'RAPPEL-2026-042');

    expect(resultat.lotId).toBe(lotId);
    expect(resultat.numeroLotFournisseur).toBe('RAPPEL-2026-042');
  });

  it("continue de fonctionner avec l'identifiant technique (aucune régression)", () => {
    const { base, idFournisseur, ingredients } = preparerBase();
    const lotId = recevoirUnLot(base, idFournisseur, ingredients[0]!, 'RAPPEL-2026-042');

    const resultat = tracabiliteAvalLot(base, lotId);

    expect(resultat.lotId).toBe(lotId);
  });

  it('refuse explicitement (jamais un choix arbitraire) quand plusieurs lots partagent le même numéro', () => {
    const { base, idFournisseur, ingredients } = preparerBase();
    recevoirUnLot(base, idFournisseur, ingredients[0]!, 'LOT-PARTAGE');
    recevoirUnLot(base, idFournisseur, ingredients[1]!, 'LOT-PARTAGE');

    expect(() => tracabiliteAvalLot(base, 'LOT-PARTAGE')).toThrow(ErreurMetier);
    try {
      tracabiliteAvalLot(base, 'LOT-PARTAGE');
      expect.unreachable('devait lever ErreurMetier');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).message).toContain('2 lots');
    }
  });

  it("lève ErreurIntrouvable quand ni l'identifiant ni le numéro ne correspondent à rien", () => {
    const { base } = preparerBase();
    expect(() => tracabiliteAvalLot(base, 'rien-de-tout-ca')).toThrow(ErreurIntrouvable);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. DÉFAUTS CORRIGÉS PENDANT LA SECONDE PASSE DE CET AUDIT
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * DÉFAUT CORRIGÉ — un lot bloqué pour RAPPEL FOURNISSEUR n'ouvrait AUCUNE
 * non-conformité.
 *
 * Constat d'origine. `packages/core/src/motifs.ts` déclare le motif
 * `RAPPEL_FOURNISSEUR` — « Bloqué suite à un rappel fournisseur » —
 * utilisable par `changerStatutLot` (`packages/db/src/services/mouvements.ts`).
 * Cette fonction écrivait un mouvement de perte (si le lot n'était pas vide)
 * et une ligne dans `journal_audit` — mais n'appelait JAMAIS
 * `declarerNonConformite`. Un rappel fournisseur, l'événement le plus grave
 * que ce catalogue de motifs sache nommer, ne laissait donc AUCUNE trace dans
 * la table `non_conformite`.
 *
 * Conséquence mesurée sur le document opposable. `registreAfscaMensuel`
 * (`apps/api/src/documents/registre-afsca.ts`) tire sa section
 * « Non-conformités » exclusivement de `nonConformitesPeriode`, qui lit CETTE
 * table. Le `journal_audit` n'est imprimé nulle part dans le registre mensuel.
 * Un rappel fournisseur qui a bloqué un lot était donc ABSENT du registre
 * présenté à un contrôle, alors que c'est exactement le genre d'événement
 * qu'un tel registre existe pour documenter.
 *
 * Correction. `changerStatutLot` appelle désormais `declarerNonConformite`
 * DANS SA PROPRE TRANSACTION, pour les motifs que `motifOuvreNonConformite`
 * (`packages/db/src/services/mouvements.ts`) retient comme traduisant un
 * incident sanitaire : `RAPPEL_FOURNISSEUR`, `QUARANTAINE_DOUTE`,
 * `DLC_DEPASSEE`, `NON_CONFORME` — voir ce prédicat pour la justification
 * complète, y compris pourquoi `LEVEE_QUARANTAINE` en est explicitement
 * exclu. C'est le même principe que la fiche 15
 * (`ecrireReleveTemperature` — « une non-conformité qu'on peut oublier
 * d'ouvrir n'est pas un contrôle »), appliqué à un événement différent que
 * cette fiche n'avait pas couvert.
 *
 * Ce test, ex-`it.fails`, est désormais un test de NON-RÉGRESSION : son
 * assertion n'a pas changé, seul `.fails` a disparu.
 */
describe('Changement de statut de lot pour rappel fournisseur', () => {
  it('bloquer un lot pour RAPPEL_FOURNISSEUR ouvre une non-conformité liée à ce lot (comme un relevé hors seuil, fiche 15)', () => {
    const { base, idFournisseur, ingredients } = preparerBase();
    const lotId = recevoirUnLot(base, idFournisseur, ingredients[0]!, 'RAPPEL-FOURNISSEUR-01');

    changerStatutLot(base, lotId, 'bloque', 'RAPPEL_FOURNISSEUR', JOUR);

    const liee = listerNonConformites(base).find((n) => n.lotId === lotId);
    expect(
      liee,
      'aucune non-conformité ouverte automatiquement — le rappel fournisseur ' +
        'serait absent du registre AFSCA mensuel imprimé',
    ).toBeDefined();
    // L'événement le plus grave du catalogue de motifs mérite la gravité
    // maximale — jamais une gravité par défaut qui banaliserait un rappel.
    expect(liee!.gravite).toBe('critique');
    expect(liee!.dateConstat).toBe(JOUR);
    expect(liee!.dateResolution).toBeNull();
  });

  /**
   * QUARANTAINE_DOUTE fait aussi partie des motifs retenus : le libellé du
   * motif dit lui-même « conformité à vérifier », qui EST un doute sanitaire
   * non résolu.
   */
  it('mettre un lot en quarantaine pour doute de conformité ouvre aussi une non-conformité, en gravité majeure', () => {
    const { base, idFournisseur, ingredients } = preparerBase();
    const lotId = recevoirUnLot(base, idFournisseur, ingredients[0]!, 'DOUTE-01');

    changerStatutLot(base, lotId, 'quarantaine', 'QUARANTAINE_DOUTE', JOUR);

    const liee = listerNonConformites(base).find((n) => n.lotId === lotId);
    expect(liee).toBeDefined();
    expect(liee!.gravite).toBe('majeure');
  });

  /**
   * Symétrique pour une DESTRUCTION motivée par une DLC dépassée : c'est une
   * perte SUBIE, pas un choix de gestion — voir `motifOuvreNonConformite`.
   * `DLC_DEPASSEE` n'est proposé par aucun écran pour un changement de statut
   * (le formulaire ne montre que la catégorie `statut_lot`), mais
   * `changerStatutLot` reste correct même appelée directement avec ce motif.
   */
  it('détruire un lot pour DLC dépassée ouvre une non-conformité (perte subie, pas un ajustement)', () => {
    const { base, idFournisseur, ingredients } = preparerBase();
    const lotId = recevoirUnLot(base, idFournisseur, ingredients[0]!, 'DLC-01');

    changerStatutLot(base, lotId, 'detruit', 'DLC_DEPASSEE', JOUR);

    const liee = listerNonConformites(base).find((n) => n.lotId === lotId);
    expect(liee).toBeDefined();
    expect(liee!.gravite).toBe('majeure');
  });

  /**
   * LEVEE_QUARANTAINE est la RÉSOLUTION d'un doute déjà tracé, jamais un
   * nouvel incident : l'ouvrir ici doublerait la non-conformité déjà créée
   * par la mise en quarantaine ci-dessus.
   */
  it('lever une quarantaine n’ouvre AUCUNE non-conformité supplémentaire', () => {
    const { base, idFournisseur, ingredients } = preparerBase();
    const lotId = recevoirUnLot(base, idFournisseur, ingredients[0]!, 'DOUTE-02');

    changerStatutLot(base, lotId, 'quarantaine', 'QUARANTAINE_DOUTE', JOUR);
    const avant = listerNonConformites(base).filter((n) => n.lotId === lotId).length;

    changerStatutLot(base, lotId, 'disponible', 'LEVEE_QUARANTAINE', JOUR);

    expect(listerNonConformites(base).filter((n) => n.lotId === lotId)).toHaveLength(avant);
  });

  /**
   * Un ajustement d'inventaire n'est pas un incident sanitaire : voir
   * `motifOuvreNonConformite` pour la justification de cette exclusion.
   * `INVENTAIRE_ECART` n'est normalement jamais utilisé pour un changement de
   * statut (il vaut pour `enregistrerSortie`), mais le prédicat doit rester
   * correct même appelé hors de son usage habituel : `changerStatutLot`
   * accepte n'importe quel `CodeMotif`.
   */
  it('un motif d’ajustement n’ouvre PAS de non-conformité, même passé à changerStatutLot', () => {
    const { base, idFournisseur, ingredients } = preparerBase();
    const lotId = recevoirUnLot(base, idFournisseur, ingredients[0]!, 'AJUSTEMENT-01');

    changerStatutLot(base, lotId, 'bloque', 'INVENTAIRE_ECART', JOUR);

    expect(listerNonConformites(base).find((n) => n.lotId === lotId)).toBeUndefined();
  });
});

/**
 * DÉFAUT CORRIGÉ — la traçabilité AVAL d'un lot ne montrait pas les
 * non-conformités qui lui sont rattachées.
 *
 * Constat d'origine. `nonConformite.lotId` existe en base, dans le contrat
 * (`schemaCreationNonConformite.lotId`, `packages/core/src/contrats/afsca.ts`)
 * et peut être saisi depuis l'écran (`RegistreAfsca.tsx`, corrigé pendant la
 * première passe de cet audit). Mais `tracabiliteAvalLot`
 * (`packages/db/src/depots/tracabilite.ts`) ne consultait JAMAIS la table
 * `non_conformite` : la réponse à « ce lot est rappelé : a-t-il déjà fait
 * l'objet d'une non-conformité (odeur, aspect, doute) ? » n'était donc visible
 * NULLE PART depuis l'écran de traçabilité, même quand la donnée existait.
 *
 * Correction, sur les DEUX côtés à la fois pour éviter la troncature
 * silencieuse par `.parse()` :
 *  - `schemaTracabiliteAvalLot` (`packages/core/src/contrats/afsca.ts`) porte
 *    désormais `nonConformites: z.array(schemaNonConformite)` ;
 *  - `tracabiliteAvalLot` (`packages/db/src/depots/tracabilite.ts`) lit
 *    `non_conformite` par `lotId`, les plus récentes en tête ;
 *  - `RegistreAfsca.tsx` affiche ce bloc EN PREMIER dans le panneau Aval,
 *    avant même les productions consommatrices.
 *
 * Ce test, ex-`it.fails`, est désormais un test de NON-RÉGRESSION, avec des
 * assertions TYPÉES (le contournement `as unknown as {...}` d'origine — qui
 * documentait justement l'ABSENCE du champ sur le type — n'a plus lieu
 * d'être).
 */
describe("Traçabilité aval d'un lot — non-conformités liées", () => {
  it('la traçabilité aval d’un lot rappelé fait apparaître les non-conformités qui lui sont rattachées', () => {
    const { base, idFournisseur, ingredients } = preparerBase();
    const lotId = recevoirUnLot(base, idFournisseur, ingredients[0]!, 'LOT-SUSPECT-01');

    const nc = declarerNonConformite(base, {
      dateConstat: JOUR,
      type: 'Doute sur la conformité',
      description: 'Odeur suspecte constatée à la réception.',
      gravite: 'majeure',
      actionCorrective: 'Lot mis en quarantaine dans Stock.',
      lotId,
    });

    const resultat = tracabiliteAvalLot(base, lotId);

    expect(resultat.nonConformites).toHaveLength(1);
    expect(resultat.nonConformites[0]!.id).toBe(nc.id);
    expect(resultat.nonConformites[0]!.description).toContain('Odeur suspecte');
  });

  it("rend un tableau vide, jamais absent, quand aucune non-conformité n'est rattachée au lot", () => {
    const { base, idFournisseur, ingredients } = preparerBase();
    const lotId = recevoirUnLot(base, idFournisseur, ingredients[0]!, 'LOT-SANS-DOUTE');

    const resultat = tracabiliteAvalLot(base, lotId);

    expect(resultat.nonConformites).toEqual([]);
  });
});

/**
 * DÉFAUT CORRIGÉ — le balayage anti-suppression
 * (`non-suppression-historique.test.ts`) ne protégeait pas les tables
 * réglementaires du registre AFSCA.
 *
 * Constat d'origine. Ce garde-fou (D-045 : « une liste écrite à la main n'est
 * pas une preuve d'absence ») ne couvrait que quatre tables — `session_vente`,
 * `session_marche`, `production`, `mouvement_stock` — choisies pour la
 * question de rétention RGPD de `docs/demandes/07`. Aucun `DELETE` n'existait
 * sur `lot`, `non_conformite`, `releve_temperature`, `nettoyage_execution`,
 * `exercice_tracabilite`, `journal_audit` ou `document_genere` (vérifié par
 * `grep -rn "\.delete(" apps packages --include="*.ts"` hors fichiers de
 * test, le 29/07/2026), mais rien ne l'aurait empêché demain, sans que ce
 * balayage ne s'en aperçoive.
 *
 * Correction. `TABLES_PROTEGEES` (`packages/db/src/non-suppression-historique.test.ts`)
 * couvre désormais ces sept tables en plus des quatre premières — MÊME
 * MÉTHODE que D-045 exige (un vrai balayage du code source, jamais une liste
 * d'affirmations), et le détecteur reste vérifié par falsification (positif
 * sur un vrai `DELETE`, négatif sur un `Map.delete` ou un préfixe d'un autre
 * identifiant).
 *
 * Chaque test ci-dessous, ex-`it.fails`, rejoue `suppressionsDangereuses`
 * (fonction PURE, exportée par `non-suppression-historique.test.ts`) sur un
 * extrait fictif de DELETE Drizzle : il passe désormais parce que la table
 * figure dans `TABLES_PROTEGEES`.
 */
describe('Portée du balayage anti-suppression — tables AFSCA', () => {
  const tablesAfscaCritiques: readonly { readonly nom: string; readonly extrait: string }[] = [
    { nom: 'lot', extrait: 'base.delete(lot).where(eq(lot.id, id)).run();' },
    {
      nom: 'non_conformite',
      extrait: 'base.delete(nonConformite).where(eq(nonConformite.id, id)).run();',
    },
    {
      nom: 'releve_temperature',
      extrait: 'base.delete(releveTemperature).where(eq(releveTemperature.id, id)).run();',
    },
    {
      nom: 'nettoyage_execution',
      extrait: 'base.delete(nettoyageExecution).where(eq(nettoyageExecution.id, id)).run();',
    },
    {
      nom: 'exercice_tracabilite',
      extrait: 'base.delete(exerciceTracabilite).where(eq(exerciceTracabilite.id, id)).run();',
    },
    {
      nom: 'journal_audit',
      extrait: 'base.delete(journalAudit).where(eq(journalAudit.id, id)).run();',
    },
    {
      nom: 'document_genere',
      extrait: 'base.delete(documentGenere).where(eq(documentGenere.id, id)).run();',
    },
  ];

  for (const { nom, extrait } of tablesAfscaCritiques) {
    it(`un DELETE sur \`${nom}\` est détecté par le balayage anti-suppression, au même titre que sur les quatre tables déjà protégées`, () => {
      expect(suppressionsDangereuses(extrait, 'fixture.ts')).not.toEqual([]);
    });
  }
});
