/**
 * Audit de la comptabilité et des seuils légaux — deuxième passe.
 *
 * Fait suite à `docs/16-AUDIT-COMPTABILITE.md` et aux corrections D-052 à
 * D-054. Ce fichier encode ce que cette deuxième passe a trouvé :
 *
 *  1. La commission SumUp (`session_marche.commission_carte_cents`) était
 *     absente de `syntheseExercice` — CORRIGÉ dans ce lot (voir
 *     `depots/comptabilite.ts`). Elle entrait déjà dans `margeNetteCents`
 *     (comptabilité analytique) mais aucune ligne de la comptabilité générale
 *     ne la reprenait : la charge de l'exercice était sous-estimée, donc le
 *     bénéfice, les cotisations et l'impôt estimés SURESTIMÉS d'autant.
 *     Chiffré sur le parcours ERP de référence : 152 centimes sur 9 000
 *     centimes de CA carte (taux à 1,69 %). Non-régression ci-dessous.
 *
 *  2. Le compteur SCE / caisse enregistreuse certifiée (docs/16 §5.6,
 *     docs/07 §6.7) était ENTIÈREMENT ABSENT : ni clé de paramètre
 *     `seuil_sce_cents`, ni quatrième entrée dans `SEUILS`
 *     (`packages/db/src/depots/sessions.ts`). CORRIGÉ dans ce lot : la clé
 *     existe désormais dans `packages/core/src/parametres.ts`, sourcée
 *     (SPF Finances — seuil SCE/GKS de 25 000 € HTVA sur les services de
 *     restaurant et de restauration, hors boissons, vérifié le 2026-07-29),
 *     et `SEUILS` porte une quatrième entrée dont l'assiette est
 *     `session_marche.ca_sur_place_cents` — jamais le CA total, sur le
 *     modèle exact de D-054 pour le revenu net. Le câblage de l'assiette est
 *     vérifié en non-régression dans `comptabilite-seuils-et-audit.test.ts` ;
 *     ce fichier-ci vérifie seulement que la clé existe au catalogue, avec
 *     une source et une date de validité, comme les trois autres seuils.
 *
 * Aucune assertion ne porte sur une valeur absolue que la graine pourrait
 * déplacer : tout est écart mesuré ou invariant reconstitué depuis la source
 * de vérité lue, même discipline que `comptabilite-seuils-et-audit.test.ts`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  appliquerPointsDeBase,
  maintenantUtc,
  nouvelIdentifiant,
  CATALOGUE_PARAMETRES,
} from '@batte/core';
import { creerBase, type BaseBatte } from './client.js';
import { migrer } from './migrer.js';
import { seed } from './seed/index.js';
import { seedDemonstration } from './seed/demonstration.js';
import { lieuMarche, produitVente, sessionMarche } from './schema.js';
import { syntheseExercice, totalAchatsMarchandisesCents } from './depots/comptabilite.js';
import { lireParametres } from './depots/parametres.js';
import { cloturerSession, creerSession } from './services/sessions.js';

/** Exercice volontairement lointain : aucune donnée de graine ne s'y trouve. */
const EXERCICE = 2033;

describe('audit comptabilite (2e passe) — commission carte dans la synthese d exercice', () => {
  let base: BaseBatte;
  let idLieu: string;
  let idProduit: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    seedDemonstration(base);

    const maintenant = maintenantUtc();
    idLieu = nouvelIdentifiant();
    base
      .insert(lieuMarche)
      .values({
        id: idLieu,
        nom: 'La Batte (test commission)',
        jourSemaine: 0,
        heureDebut: '08:00',
        heureFin: '14:30',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    const produit = base
      .select({ id: produitVente.id })
      .from(produitVente)
      .where(eq(produitVente.nature, 'transforme'))
      .get();
    expect(produit, 'la démonstration doit fournir un produit transformé').toBeDefined();
    idProduit = produit!.id;
  });

  /**
   * NON-RÉGRESSION : la commission SumUp d'une session close réduit
   * désormais le bénéfice de l'EXERCICE, pas seulement la marge de la
   * SESSION. Avant correction, `depensesDeductiblesCents` valait
   * `achatsMarchandisesCents + fraisSessionCents` (la commission manquait) ;
   * `syntheseExercice` lit maintenant aussi
   * `session_marche.commission_carte_cents`.
   */
  it('la commission carte réduit le bénéfice brut de l’exercice, au centime près', () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: `${EXERCICE}-08-02` });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idProduit, quantite: 30, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 2200, deplacementCents: 1400, gazCents: 600, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 0,
      caCarteCents: 9_000,
      crepesProduites: 30,
      crepesInvendues: 0,
      crepesCassees: 0,
      heureDebutReelle: '08:00',
      heureFinReelle: '14:30',
    });

    const ligne = base
      .select({
        caTotalCents: sessionMarche.caTotalCents,
        commissionCarteCents: sessionMarche.commissionCarteCents,
      })
      .from(sessionMarche)
      .where(eq(sessionMarche.id, session.id))
      .get();
    expect(ligne?.commissionCarteCents).not.toBeNull();
    expect(ligne!.commissionCarteCents!).toBeGreaterThan(0);

    const achatsMarchandisesCents = totalAchatsMarchandisesCents(base, EXERCICE);
    const fraisSessionCents = 2200 + 1400 + 600;
    const synthese = syntheseExercice(base, EXERCICE);

    // La synthese reprend les QUATRE populations, la commission comprise —
    // et rien d'autre : pas de cout matiere (D-038/D-049), pas de double
    // compte sur les achats.
    expect(synthese.depensesDeductiblesCents).toBe(
      achatsMarchandisesCents + fraisSessionCents + ligne!.commissionCarteCents!,
    );
    expect(synthese.beneficeBrutCents).toBe(
      ligne!.caTotalCents! -
        achatsMarchandisesCents -
        fraisSessionCents -
        ligne!.commissionCarteCents!,
    );
  });

  /** Contre-épreuve : sans encaissement carte, la commission est nulle et
   * n'ajoute rien — la correction ne doit pas inventer une charge. */
  it('n’ajoute AUCUNE charge quand la session n’encaisse aucune carte', () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: `${EXERCICE}-08-09` });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idProduit, quantite: 30, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 9_000,
      caCarteCents: 0,
      crepesProduites: 30,
      crepesInvendues: 0,
      crepesCassees: 0,
      heureDebutReelle: '08:00',
      heureFinReelle: '14:30',
    });

    const ligne = base
      .select({ commissionCarteCents: sessionMarche.commissionCarteCents })
      .from(sessionMarche)
      .where(eq(sessionMarche.id, session.id))
      .get();
    expect(ligne?.commissionCarteCents ?? 0).toBe(0);

    const synthese = syntheseExercice(base, EXERCICE);
    expect(synthese.depensesDeductiblesCents).toBe(totalAchatsMarchandisesCents(base, EXERCICE));
  });

  /**
   * Chiffrage indépendant : reconstitue la commission depuis le TAUX de
   * paramètre plutôt que depuis la colonne déjà écrite, pour ne pas rendre le
   * test tautologique (même piège que celui documenté dans
   * `comptabilite-seuils-et-audit.test.ts` pour le CA des lignes de vente).
   */
  it('la commission comptée correspond exactement au taux de parametre appliqué au CA carte', () => {
    const session = creerSession(base, { lieuId: idLieu, dateSession: `${EXERCICE}-08-16` });
    cloturerSession(base, session.id, {
      ventes: [{ produitVenteId: idProduit, quantite: 30, prixUnitaireCents: 300 }],
      frais: { emplacementCents: 0, deplacementCents: 0, gazCents: 0, diversCents: 0 },
      fondsCaisseInitialCents: 0,
      especesCompteesCents: 0,
      caCarteCents: 9_000,
      crepesProduites: 30,
      crepesInvendues: 0,
      crepesCassees: 0,
      heureDebutReelle: '08:00',
      heureFinReelle: '14:30',
    });

    const parametres = lireParametres(base, `${EXERCICE}-08-16`);
    const tauxBp = parametres.pointsDeBase('taux_commission_sumup_bp');
    const commissionAttendueCents = appliquerPointsDeBase(9_000, tauxBp);

    const synthese = syntheseExercice(base, EXERCICE);
    expect(synthese.depensesDeductiblesCents).toBe(
      totalAchatsMarchandisesCents(base, EXERCICE) + commissionAttendueCents,
    );
  });
});

/**
 * NON-RÉGRESSION (ex-`it.fails`) — le compteur SCE / caisse enregistreuse
 * certifiée (docs/16-AUDIT-COMPTABILITE §5.6, docs/07-DOCTRINE-ERP-ET-DESIGN
 * §6.7) était entièrement absent. CORRIGÉ : `seuil_sce_cents` existe
 * désormais au catalogue, avec une source et une date de validité (CLAUDE.md
 * §7). Le câblage de l'assiette (`ca_sur_place_cents`, jamais le CA total)
 * est vérifié séparément dans `comptabilite-seuils-et-audit.test.ts`.
 *
 * La valeur par défaut (25 000 € HTVA) est VÉRIFIÉE, pas devinée : SPF
 * Finances, systemedecaisseenregistreuse.be/fr/qui-quand — « le chiffre
 * d'affaires hors TVA, relatif aux services de restaurant et de restauration,
 * à l'exclusion de la fourniture de boissons, dépasse 25.000 euros ». Seuil
 * fixé par l'arrêté royal de 2016 remplaçant la règle des 10 % par la règle
 * des 25 000 €, inchangé depuis (vérifié le 2026-07-29 ; les échéances
 * 2025-2026 de la migration SCE 2.0 portent sur le système technique, pas sur
 * ce montant). Ce test fige donc la valeur : un changement de ce nombre doit
 * être une décision explicite et sourcée, pas un accident de refactor.
 */
describe('audit comptabilite (2e passe) — seuil SCE', () => {
  it('le catalogue de parametres porte une cle seuil_sce_cents, sourcee et datee', () => {
    const cle = CATALOGUE_PARAMETRES.find((p) => p.cle === 'seuil_sce_cents');
    expect(cle, 'clé seuil_sce_cents attendue au catalogue').toBeDefined();
    expect(cle!.typeValeur).toBe('entier');
    // 25 000 € HTVA, en centimes — voir la source complète sur la clé.
    expect(Number(cle!.valeurDefaut)).toBe(2_500_000);
    expect(cle!.source.length).toBeGreaterThan(0);
    expect(cle!.dateDebutValidite).toBe('2026-01-01');
  });
});
