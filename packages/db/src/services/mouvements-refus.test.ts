/**
 * Les refus de `services/mouvements.ts` que rien n'exerçait.
 *
 * Le stock ne se modifie QUE par un mouvement (CLAUDE.md §3 règle 5) : ce
 * fichier est donc le point de passage unique par lequel une quantité peut
 * bouger. Chacune de ses gardes est la dernière chose qui se tient entre une
 * saisie fautive et un stock faux — or aucune n'était couverte :
 *
 *  - quantité nulle ou négative (`quantite_invalide`) ;
 *  - ingrédient inexistant (`ingredient_introuvable`, 404) ;
 *  - catalogue de motifs absent de la base (`motif_inconnu`, 500) ;
 *  - contrepassation d'un mouvement inexistant (`mouvement_introuvable`) ;
 *  - lot inexistant / statut inchangé sur `changerStatutLot` ;
 *  - paramètre `afsca_motifs_incident_sanitaire_json` mal saisi.
 *
 * Ce dernier mérite une note : le paramètre décide QUELS motifs de destruction
 * ouvrent automatiquement une non-conformité AFSCA. Éditable depuis l'écran
 * Paramètres, donc saisissable en JSON invalide — et un JSON invalide qui
 * passerait silencieusement ferait disparaître l'ouverture automatique de
 * non-conformité sur un incident sanitaire réel.
 *
 * `seedDemonstration` n'est PAS appelée : chaque fixture est construite ici,
 * pour que la situation testée soit celle décrite et non un reste de la
 * démonstration.
 */

import { ErreurMetier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { fournisseur, ingredient, lot, mouvementStock, parametre } from '../schema.js';
import { enregistrerReception } from './reception.js';
import { annulerMouvement, changerStatutLot, enregistrerSortie } from './mouvements.js';

/** Vérifie le CODE machine, jamais un extrait de message français. */
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

describe('services/mouvements — refus jamais exercés', () => {
  let base: BaseBatte;
  let idFarine: string;
  let idFournisseur: string;
  let idLot: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);

    const maintenant = maintenantUtc();
    idFournisseur = nouvelIdentifiant();
    base
      .insert(fournisseur)
      .values({
        id: idFournisseur,
        nom: 'Moulin de test',
        type: 'moulin',
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    idFarine = nouvelIdentifiant();
    base
      .insert(ingredient)
      .values({
        id: idFarine,
        nom: 'Farine T55 de test',
        categorie: 'farine',
        uniteReference: 'g',
        allergenes: ['gluten'],
        stockSecurite: 0,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    enregistrerReception(base, {
      fournisseurId: idFournisseur,
      dateReception: '2026-01-05',
      lignes: [
        {
          ingredientId: idFarine,
          quantite: 25_000,
          prixLigneCents: 2500,
          numeroLotFournisseur: 'LOT-REFUS-1',
          dateDlc: '2026-12-31',
        },
      ],
    });

    idLot = base.select({ id: lot.id }).from(lot).where(eq(lot.ingredientId, idFarine)).get()!.id;
  });

  /* ── enregistrerSortie ───────────────────────────────────────────────── */

  it('refuse une sortie de quantité nulle, et n’écrit AUCUN mouvement', () => {
    const avant = base.select().from(mouvementStock).all().length;
    attendCode(
      () =>
        enregistrerSortie(base, {
          ingredientId: idFarine,
          quantite: 0,
          type: 'perte',
          motifCode: 'CASSE_CUISSON',
          dateMouvement: '2026-01-10',
        }),
      'quantite_invalide',
    );
    // Règle 5 : un refus ne doit surtout pas laisser derrière lui un mouvement
    // à zéro, qui polluerait l'historique auditable.
    expect(base.select().from(mouvementStock).all().length).toBe(avant);
  });

  it('refuse une sortie de quantité négative', () => {
    const erreur = attendCode(
      () =>
        enregistrerSortie(base, {
          ingredientId: idFarine,
          quantite: -500,
          type: 'perte',
          motifCode: 'CASSE_CUISSON',
          dateMouvement: '2026-01-10',
        }),
      'quantite_invalide',
    );
    expect(erreur.champs).toHaveProperty('quantite');
  });

  it('accepte toujours une sortie d’UNE unité — la garde porte sur « <= 0 », pas sur « petit »', () => {
    // Discrimine : une garde écrite `< 1` ou `<= 1` passerait les deux tests
    // ci-dessus tout en refusant à tort le gramme unique.
    const resultat = enregistrerSortie(base, {
      ingredientId: idFarine,
      quantite: 1,
      type: 'perte',
      motifCode: 'CASSE_CUISSON',
      dateMouvement: '2026-01-10',
    });
    expect(resultat.mouvements.length).toBe(1);
  });

  it('refuse une sortie sur un ingrédient inexistant, en 404', () => {
    const erreur = attendCode(
      () =>
        enregistrerSortie(base, {
          ingredientId: nouvelIdentifiant(),
          quantite: 100,
          type: 'perte',
          motifCode: 'CASSE_CUISSON',
          dateMouvement: '2026-01-10',
        }),
      'ingredient_introuvable',
    );
    // 404 et non 422 : l'identifiant vient de l'URL/du référentiel, pas d'un
    // champ de formulaire (convention D-035).
    expect(erreur.statut).toBe(404);
  });

  it('refuse une sortie quand le catalogue de motifs n’est pas chargé, en 500', () => {
    // Situation réelle : base migrée mais `npm run db:seed` jamais lancé.
    // Ce n'est pas une faute de saisie de l'utilisateur — d'où le 500 et le
    // message qui nomme la commande à lancer.
    const vierge = creerBase(':memory:');
    migrer(vierge);
    const maintenant = maintenantUtc();
    const idF = nouvelIdentifiant();
    vierge
      .insert(ingredient)
      .values({
        id: idF,
        nom: 'Farine sans catalogue',
        categorie: 'farine',
        uniteReference: 'g',
        allergenes: [],
        stockSecurite: 0,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    const erreur = attendCode(
      () =>
        enregistrerSortie(vierge, {
          ingredientId: idF,
          quantite: 100,
          type: 'perte',
          motifCode: 'CASSE_CUISSON',
          dateMouvement: '2026-01-10',
        }),
      'motif_inconnu',
    );
    expect(erreur.statut).toBe(500);
  });

  /* ── contrepassation ─────────────────────────────────────────────────── */

  it('refuse de contrepasser un mouvement inexistant, en 404', () => {
    const erreur = attendCode(
      () => annulerMouvement(base, nouvelIdentifiant(), 'ERREUR_SAISIE'),
      'mouvement_introuvable',
    );
    expect(erreur.statut).toBe(404);
  });

  /* ── changerStatutLot ────────────────────────────────────────────────── */

  it('refuse de changer le statut d’un lot inexistant, en 404', () => {
    const erreur = attendCode(
      () =>
        changerStatutLot(
          base,
          nouvelIdentifiant(),
          'quarantaine',
          'QUARANTAINE_DOUTE',
          '2026-01-10',
        ),
      'lot_introuvable',
    );
    expect(erreur.statut).toBe(404);
  });

  it('refuse un changement vers le statut DÉJÀ en place, sans écrire de ligne d’audit', () => {
    const statutActuel = base
      .select({ statut: lot.statut })
      .from(lot)
      .where(eq(lot.id, idLot))
      .get()!.statut;
    expect(statutActuel).toBe('disponible');

    attendCode(
      () => changerStatutLot(base, idLot, 'disponible', 'QUARANTAINE_DOUTE', '2026-01-10'),
      'statut_inchange',
    );
  });

  it('accepte le MÊME appel vers un statut réellement différent', () => {
    // Discrimine : sans ce cas, `statut_inchange` pourrait masquer un refus
    // général de `changerStatutLot` sur cette fixture.
    changerStatutLot(base, idLot, 'quarantaine', 'QUARANTAINE_DOUTE', '2026-01-10');
    const apres = base.select({ statut: lot.statut }).from(lot).where(eq(lot.id, idLot)).get()!;
    expect(apres.statut).toBe('quarantaine');
  });

  /* ── paramètre des motifs d'incident sanitaire ───────────────────────── */

  /** Écrase la valeur en vigueur d'une clé de paramètre, en base. */
  function forcerParametre(valeur: string): void {
    base
      .update(parametre)
      .set({ valeur, modifieLe: maintenantUtc() })
      .where(eq(parametre.cle, 'afsca_motifs_incident_sanitaire_json'))
      .run();
  }

  it('refuse de détruire un lot quand la liste des motifs sanitaires n’est pas du JSON valide', () => {
    forcerParametre('["RAPPEL_FOURNISSEUR",');
    const erreur = attendCode(
      () => changerStatutLot(base, idLot, 'detruit', 'RAPPEL_FOURNISSEUR', '2026-01-10'),
      'parametre_motifs_incident_sanitaire_invalide',
    );
    expect(erreur.message).toContain('afsca_motifs_incident_sanitaire_json');
  });

  it('refuse une liste de motifs qui est du JSON valide mais PAS un tableau de codes', () => {
    // Piège distinct du précédent : `JSON.parse` réussit, la valeur est
    // simplement du mauvais type. Sans cette seconde garde, `new Set(42)`
    // lèverait une erreur technique non traduite au fond du service.
    forcerParametre('{"RAPPEL_FOURNISSEUR": true}');
    attendCode(
      () => changerStatutLot(base, idLot, 'detruit', 'RAPPEL_FOURNISSEUR', '2026-01-10'),
      'parametre_motifs_incident_sanitaire_invalide',
    );

    forcerParametre('["RAPPEL_FOURNISSEUR", 42]');
    attendCode(
      () => changerStatutLot(base, idLot, 'detruit', 'RAPPEL_FOURNISSEUR', '2026-01-10'),
      'parametre_motifs_incident_sanitaire_invalide',
    );
  });

  it('accepte la destruction avec la valeur par défaut du catalogue — la garde ne bloque pas le cas normal', () => {
    const resultat = changerStatutLot(base, idLot, 'detruit', 'RAPPEL_FOURNISSEUR', '2026-01-10');
    const apres = base.select({ statut: lot.statut }).from(lot).where(eq(lot.id, idLot)).get()!;
    expect(apres.statut).toBe('detruit');
    // Règle 5 : la destruction SORT la matière restante par un mouvement de
    // perte, jamais par une remise à zéro de la quantité du lot.
    expect(resultat.mouvementDestructionId).not.toBeNull();
    expect(resultat.quantiteDetruite).toBe(25_000);
  });
});
