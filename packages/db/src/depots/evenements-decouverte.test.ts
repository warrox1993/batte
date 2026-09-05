/**
 * Tests du dépôt de découverte automatique d'événements (fiche
 * `docs/demandes/05-EVENEMENTS-DECOUVERTE-IA-RAYON-REGLABLE.md`).
 *
 * Ce qui est réellement mis à l'épreuve :
 *
 *  - **rien n'entre en base sans validation humaine** (CLAUDE.md §3 règle 2) :
 *    une proposition IA reste `valide_par_humain = false` tant qu'elle n'a
 *    pas été validée explicitement.
 *  - **`impactEstimeBp` n'est JAMAIS reçu tel quel** : il est recalculé à
 *    partir de la portée et de l'intensité, à la création COMME à la
 *    validation (même après ajustement).
 *  - **une fois validée, la ligne entre dans le calcul de prévision SANS
 *    câblage supplémentaire** : `evenementsDuJour` (`./previsions.js`) la
 *    voit directement, puisqu'il ne filtre que sur `valide_par_humain`.
 *  - **rien ne s'efface** (règle 7) : un rejet ne supprime jamais la ligne,
 *    il écrit `rejete_le`.
 *  - **le lieu, la distance et la commune vivent dans des colonnes dédiées**
 *    (`lieu_id`, `distance_km`, `commune_texte`) — plus dans `notes` — et
 *    **éditer `notes` à la main ne casse plus rien** (c'est tout l'intérêt du
 *    remboursement de dette : `notes` était auparavant un format encodé que
 *    l'écran Événements laissait l'utilisateur corrompre sans le savoir).
 *  - **le tri par rentabilité décroissante** fonctionne sur des propositions
 *    de lieux différents (chacune avec sa propre baseline).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ErreurMetier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { seed } from '../seed/index.js';
import { eq } from 'drizzle-orm';
import { evenement, lieuMarche, produitVente } from '../schema.js';
import { evenementsDuJour } from './previsions.js';
import {
  creerPropositionEvenementIa,
  listerPropositionsEnAttente,
  lieuPourRechercheEvenements,
  nombrePropositionsEnAttente,
  reglerRayonRechercheEvenements,
  rejeterPropositionEvenement,
  validerPropositionEvenement,
  type EntreePropositionEvenementIa,
} from './evenements-decouverte.js';

function insererLieu(base: BaseBatte, nom: string, rayonKm = 20): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(lieuMarche)
    .values({
      id,
      nom,
      actif: true,
      rayonRechercheEvenementsKm: rayonKm,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

/** Un produit transformé, pour donner une marge unitaire non nulle au calcul de rentabilité. */
function insererProduitTransforme(base: BaseBatte, prixCents: number): void {
  const maintenant = maintenantUtc();
  base
    .insert(produitVente)
    .values({
      id: nouvelIdentifiant(),
      nom: 'Froment / cassonade',
      nature: 'transforme',
      recetteId: null,
      ingredientId: null,
      prixCents,
      nbCrepes: 1,
      categorie: null,
      consommationSurPlace: false,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
}

function propositionBrute(
  surcharges: Partial<EntreePropositionEvenementIa> = {},
): EntreePropositionEvenementIa {
  return {
    lieuId: 'lieu-defaut',
    nom: 'Braderie de Herstal',
    type: 'festival',
    dateDebut: '2026-08-15',
    dateFin: '2026-08-16',
    portee: 'quartier',
    intensiteEstimee: 3,
    distanceKm: 5,
    communeTexte: 'Herstal',
    source: 'https://exemple.be/braderie-herstal',
    resume: 'Braderie annuelle, forte affluence attendue.',
    ...surcharges,
  };
}

describe('dépôt evenements-decouverte', () => {
  let base: BaseBatte;
  let idLieu: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    idLieu = insererLieu(base, 'La Batte');
    insererProduitTransforme(base, 350);
  });

  describe('rayon de recherche', () => {
    it('lit le rayon par défaut (20 km) du lieu', () => {
      const lieu = lieuPourRechercheEvenements(base, idLieu);
      expect(lieu?.rayonRechercheEvenementsKm).toBe(20);
    });

    it('modifie le rayon vers une valeur admise', () => {
      const modifie = reglerRayonRechercheEvenements(base, idLieu, 100);
      expect(modifie.rayonRechercheEvenementsKm).toBe(100);
      expect(lieuPourRechercheEvenements(base, idLieu)?.rayonRechercheEvenementsKm).toBe(100);
    });

    it('refuse une valeur hors domaine (5|10|15|20|40|100)', () => {
      expect(() => reglerRayonRechercheEvenements(base, idLieu, 25)).toThrow(ErreurMetier);
    });

    it('refuse un lieu inexistant', () => {
      expect(() => reglerRayonRechercheEvenements(base, 'lieu-fantome', 40)).toThrow();
    });
  });

  describe('création d’une proposition', () => {
    it('insère en `source = ia`, `valide_par_humain = false` — jamais active d’office', () => {
      const cree = creerPropositionEvenementIa(base, propositionBrute({ lieuId: idLieu }));
      expect(cree.valideParHumain).toBe(false);
      expect(cree.source).toBe('ia');

      // Vérifie directement la table : aucun raccourci de lecture ne doit masquer l'état réel.
      const brute = base.select().from(evenement).all()[0]!;
      expect(brute.source).toBe('ia');
      expect(brute.valideParHumain).toBe(false);
    });

    it('calcule `impactEstimeBp` à partir de la portée et de l’intensité, jamais d’une valeur externe', () => {
      const cree = creerPropositionEvenementIa(
        base,
        propositionBrute({ lieuId: idLieu, portee: 'quartier', intensiteEstimee: 3 }),
      );
      // 1 + 1,0 × 3 × 0,05 = 1,15 -> 11500 bp (docs/03)
      expect(cree.impactEstimeBp).toBe(11_500);
    });

    it('stocke le lieu, la distance et la commune dans des colonnes dédiées (pas dans `notes`)', () => {
      const cree = creerPropositionEvenementIa(
        base,
        propositionBrute({ lieuId: idLieu, distanceKm: 7, communeTexte: 'Herstal' }),
      );
      expect(cree.lieuId).toBe(idLieu);
      expect(cree.lieuNom).toBe('La Batte'); // dérivé par jointure sur `lieu_id`, jamais stocké
      expect(cree.distanceKm).toBe(7);
      expect(cree.communeTexte).toBe('Herstal');

      // Vérifie directement les colonnes, pas seulement la lecture enrichie :
      // c'est bien `evenement.lieu_id` / `distance_km` / `commune_texte` qui
      // portent la donnée, plus un format encodé dans `notes`.
      const brute = base.select().from(evenement).where(eq(evenement.id, cree.id)).get()!;
      expect(brute.lieuId).toBe(idLieu);
      expect(brute.distanceKm).toBe(7);
      expect(brute.communeTexte).toBe('Herstal');
      // `notes` ne contient plus que le résumé, sans aucun format structuré.
      expect(brute.notes).toBe('Braderie annuelle, forte affluence attendue.');
    });

    it('arrondit `distanceKm` au km entier (colonne `distance_km` INTEGER, estimation à vol d’oiseau)', () => {
      const cree = creerPropositionEvenementIa(
        base,
        propositionBrute({ lieuId: idLieu, distanceKm: 7.5 }),
      );
      expect(cree.distanceKm).toBe(8);
    });

    it('n’entre PAS dans `evenementsDuJour` tant qu’elle n’est pas validée', () => {
      creerPropositionEvenementIa(
        base,
        propositionBrute({ lieuId: idLieu, dateDebut: '2026-08-15', dateFin: '2026-08-16' }),
      );
      expect(evenementsDuJour(base, '2026-08-15')).toHaveLength(0);
    });
  });

  describe('validation — entre dans le calcul sans câblage supplémentaire', () => {
    it('marque `valide_par_humain = true` et apparaît dans `evenementsDuJour`', () => {
      const cree = creerPropositionEvenementIa(
        base,
        propositionBrute({ lieuId: idLieu, dateDebut: '2026-08-15', dateFin: '2026-08-16' }),
      );
      expect(evenementsDuJour(base, '2026-08-15')).toHaveLength(0);

      const validee = validerPropositionEvenement(base, cree.id);
      expect(validee.valideParHumain).toBe(true);

      const actifs = evenementsDuJour(base, '2026-08-15');
      expect(actifs).toHaveLength(1);
      expect(actifs[0]!.id).toBe(cree.id);
    });

    it('recalcule `impactEstimeBp` si la portée/intensité est ajustée avant validation', () => {
      const cree = creerPropositionEvenementIa(
        base,
        propositionBrute({ lieuId: idLieu, portee: 'quartier', intensiteEstimee: 3 }),
      );
      expect(cree.impactEstimeBp).toBe(11_500);

      const validee = validerPropositionEvenement(base, cree.id, {
        portee: 'national',
        intensiteEstimee: 1,
      });
      // 1 + 0,3 × 1 × 0,05 = 1,015 -> 10150 bp
      expect(validee.impactEstimeBp).toBe(10_150);
      expect(validee.portee).toBe('national');
      expect(validee.intensiteEstimee).toBe(1);
    });

    it('refuse de valider deux fois la même proposition', () => {
      const cree = creerPropositionEvenementIa(base, propositionBrute({ lieuId: idLieu }));
      validerPropositionEvenement(base, cree.id);
      expect(() => validerPropositionEvenement(base, cree.id)).toThrow(ErreurMetier);
    });

    it('refuse de valider un identifiant inconnu', () => {
      expect(() => validerPropositionEvenement(base, 'fantome')).toThrow();
    });
  });

  describe('validation — passerelle fiche 14 (famille d’opportunité)', () => {
    it('laisse `famille` à NULL par défaut — comportement classique inchangé', () => {
      const cree = creerPropositionEvenementIa(base, propositionBrute({ lieuId: idLieu }));
      const validee = validerPropositionEvenement(base, cree.id);
      expect(validee.famille).toBeNull();
      expect(validee.effectifEstime).toBeNull();
    });

    it('tague une proposition comme opportunité au moment de la validation', () => {
      const cree = creerPropositionEvenementIa(base, propositionBrute({ lieuId: idLieu }));
      const validee = validerPropositionEvenement(base, cree.id, {
        famille: 'grand_public',
      });
      expect(validee.famille).toBe('grand_public');
    });

    it('persiste l’effectif estimé pour une opportunité entreprise', () => {
      const cree = creerPropositionEvenementIa(base, propositionBrute({ lieuId: idLieu }));
      const validee = validerPropositionEvenement(base, cree.id, {
        famille: 'entreprise',
        effectifEstime: 150,
      });
      expect(validee.famille).toBe('entreprise');
      expect(validee.effectifEstime).toBe(150);
    });

    it('force `impactEstimeBp` au NEUTRE dès qu’une famille est taguée — jamais dérivé de la portée/intensité', () => {
      const cree = creerPropositionEvenementIa(
        base,
        propositionBrute({ lieuId: idLieu, portee: 'national', intensiteEstimee: 5 }),
      );
      // Sans famille, l'impact serait dérivé (loin d'être neutre) : vérifie
      // que la neutralisation ci-dessous n'est pas un simple hasard de calcul.
      expect(cree.impactEstimeBp).not.toBe(10_000);

      const validee = validerPropositionEvenement(base, cree.id, { famille: 'marche_noel' });
      expect(validee.impactEstimeBp).toBe(10_000);

      // Vérifié aussi en base brute : une session régulière qui tomberait la
      // même date ne doit JAMAIS être modulée par cette opportunité
      // (`evenementsDuJour` / `facteurEvenementBp` ne filtrent pas sur `famille`).
      const brut = base.select().from(evenement).where(eq(evenement.id, cree.id)).get();
      expect(brut?.impactEstimeBp).toBe(10_000);
    });

    it('recalcule normalement l’impact quand la famille reste explicitement NULL (facteur classique)', () => {
      const cree = creerPropositionEvenementIa(
        base,
        propositionBrute({ lieuId: idLieu, portee: 'national', intensiteEstimee: 1 }),
      );
      const validee = validerPropositionEvenement(base, cree.id, { famille: null });
      // 1 + 0,3 × 1 × 0,05 = 1,015 -> 10150 bp — dérivé, pas neutre à zéro.
      expect(validee.impactEstimeBp).toBe(10_150);
      expect(validee.famille).toBeNull();
    });
  });

  describe('rejet — jamais un DELETE', () => {
    it('ne supprime pas la ligne, mais la retire de la liste « en attente »', () => {
      const cree = creerPropositionEvenementIa(base, propositionBrute({ lieuId: idLieu }));
      rejeterPropositionEvenement(base, cree.id);

      const lignes = base.select().from(evenement).all();
      expect(lignes).toHaveLength(1); // toujours là
      expect(lignes[0]!.valideParHumain).toBe(false); // jamais activée

      expect(listerPropositionsEnAttente(base)).toHaveLength(0);
    });

    it('écrit `rejete_le` (horodatage ISO), sans toucher à `notes`', () => {
      const cree = creerPropositionEvenementIa(base, propositionBrute({ lieuId: idLieu }));
      const notesAvant = base.select().from(evenement).where(eq(evenement.id, cree.id)).get()!
        .notes;

      rejeterPropositionEvenement(base, cree.id);

      const ligne = base.select().from(evenement).where(eq(evenement.id, cree.id)).get()!;
      expect(ligne.rejeteLe).not.toBeNull();
      expect(() => new Date(ligne.rejeteLe!).toISOString()).not.toThrow(); // horodatage ISO valide
      expect(ligne.notes).toBe(notesAvant); // aucun marqueur textuel ajouté

      // Toujours retrouvable directement en base : « rien ne s'efface »
      // (CLAUDE.md §3 règle 7) ne veut pas dire « invisible ».
      const retrouvee = base.select().from(evenement).where(eq(evenement.id, cree.id)).all();
      expect(retrouvee).toHaveLength(1);
    });

    it('refuse de rejeter une proposition déjà validée', () => {
      const cree = creerPropositionEvenementIa(base, propositionBrute({ lieuId: idLieu }));
      validerPropositionEvenement(base, cree.id);
      expect(() => rejeterPropositionEvenement(base, cree.id)).toThrow(ErreurMetier);
    });
  });

  describe('`notes` est redevenu un champ libre — régression du remboursement de dette', () => {
    it('éditer `notes` à la main (comme depuis l’écran Événements) ne casse ni le lieu, ni la distance, ni la rentabilité', () => {
      const cree = creerPropositionEvenementIa(
        base,
        propositionBrute({ lieuId: idLieu, distanceKm: 3, communeTexte: 'Herstal' }),
      );
      const rentabiliteAvant = listerPropositionsEnAttente(base)[0]!.rentabiliteEstimeeCents;

      // Simule exactement ce que fait l'écran Événements (`apps/web/src/pages/
      // Evenements.tsx`) : un `UPDATE` libre sur `notes`, rien d'autre. Avant
      // ce remboursement de dette, ceci aurait détruit le lieu/distance/
      // commune encodés dans ce même champ.
      base
        .update(evenement)
        .set({ notes: 'Une note remplacée à la main, sans rapport avec la recherche IA.' })
        .where(eq(evenement.id, cree.id))
        .run();

      const liste = listerPropositionsEnAttente(base);
      expect(liste).toHaveLength(1);
      const proposition = liste[0]!;
      expect(proposition.lieuId).toBe(idLieu);
      expect(proposition.lieuNom).toBe('La Batte');
      expect(proposition.distanceKm).toBe(3);
      expect(proposition.communeTexte).toBe('Herstal');
      expect(proposition.rentabiliteEstimeeCents).toBe(rentabiliteAvant);
      expect(proposition.notes).toBe(
        'Une note remplacée à la main, sans rapport avec la recherche IA.',
      );
    });

    it('vider `notes` (mise à `null`) ne casse pas non plus la lecture enrichie', () => {
      const cree = creerPropositionEvenementIa(base, propositionBrute({ lieuId: idLieu }));
      base.update(evenement).set({ notes: null }).where(eq(evenement.id, cree.id)).run();

      const liste = listerPropositionsEnAttente(base);
      expect(liste[0]!.lieuId).toBe(idLieu);
      expect(liste[0]!.notes).toBeNull();
    });
  });

  describe('liste en attente — triée par rentabilité décroissante', () => {
    it('trie plusieurs propositions du même lieu par rentabilité décroissante', () => {
      // Intensité 5 (impact fort) vs intensité 1 (impact faible), même distance :
      // la première doit ressortir en tête.
      const faible = creerPropositionEvenementIa(
        base,
        propositionBrute({
          lieuId: idLieu,
          nom: 'Petit marché',
          intensiteEstimee: 1,
          distanceKm: 3,
        }),
      );
      const fort = creerPropositionEvenementIa(
        base,
        propositionBrute({
          lieuId: idLieu,
          nom: 'Grand festival',
          intensiteEstimee: 5,
          distanceKm: 3,
        }),
      );

      const liste = listerPropositionsEnAttente(base);
      expect(liste.map((p) => p.id)).toEqual([fort.id, faible.id]);
      expect(liste[0]!.rentabiliteEstimeeCents).toBeGreaterThan(liste[1]!.rentabiliteEstimeeCents);
    });

    it('un événement lointain peut passer derrière un événement proche, même avec un rayon élargi', () => {
      reglerRayonRechercheEvenements(base, idLieu, 100);
      const proche = creerPropositionEvenementIa(
        base,
        propositionBrute({
          lieuId: idLieu,
          nom: 'Événement proche',
          intensiteEstimee: 3,
          distanceKm: 3,
        }),
      );
      const lointain = creerPropositionEvenementIa(
        base,
        propositionBrute({
          lieuId: idLieu,
          nom: 'Événement à 95 km',
          intensiteEstimee: 3,
          distanceKm: 95,
        }),
      );

      const liste = listerPropositionsEnAttente(base);
      expect(liste.map((p) => p.id)).toEqual([proche.id, lointain.id]);
    });
  });

  describe('compteur pour le tableau de bord', () => {
    it('compte les propositions en attente, exclut validées et rejetées', () => {
      const a = creerPropositionEvenementIa(base, propositionBrute({ lieuId: idLieu, nom: 'A' }));
      creerPropositionEvenementIa(base, propositionBrute({ lieuId: idLieu, nom: 'B' }));
      const c = creerPropositionEvenementIa(base, propositionBrute({ lieuId: idLieu, nom: 'C' }));

      expect(nombrePropositionsEnAttente(base)).toBe(3);

      validerPropositionEvenement(base, a.id);
      rejeterPropositionEvenement(base, c.id);

      expect(nombrePropositionsEnAttente(base)).toBe(1);
    });
  });
});
