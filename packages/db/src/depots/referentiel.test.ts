/**
 * Tests du depot de referentiel.
 *
 * Ce qui est reellement mis a l'epreuve ici n'est pas « le CRUD fonctionne »,
 * mais les deux garanties reglementaires du projet :
 *
 *  - **rien ne s'efface** : desactiver ne retire AUCUNE ligne de la base, sans
 *    quoi la tracabilite AFSCA amont et les pieces comptables deviendraient
 *    illisibles (CLAUDE.md §3 regle 7) ;
 *  - **rien ne change sans trace** : `fournisseur` et `produit_vente` sont des
 *    donnees de reference, donc journalisees, et le journal doit conserver la
 *    valeur ANTERIEURE — c'est elle qui repond a « quel prix pratiquiez-vous
 *    en mars ? ».
 */

import { ErreurIntrouvable, ErreurMetier, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { creerBase, type BaseBatte } from '../client.js';
import { migrer } from '../migrer.js';
import { conditionnement, fournisseur, ingredient, recette, recetteLigne } from '../schema.js';
import { seed } from '../seed/index.js';
import { FOURNISSEUR_INVENTAIRE_OUVERTURE } from '../seed/fournisseurs-systeme.js';
import { eq } from 'drizzle-orm';
import { listerJournalAudit } from './audit.js';
import { chargerRecettePourCalcul, lireRecetteDetail } from './recettes.js';
import {
  changerActiviteFournisseur,
  changerActiviteProduit,
  creerFournisseur,
  creerProduit,
  diagnostiquerRecettePourCoutNul,
  listerFournisseurs,
  listerProduits,
  modifierFournisseur,
  modifierProduit,
} from './referentiel.js';

/** Saisie de fournisseur valide, deja normalisee comme le ferait le contrat. */
function saisieFournisseur(surcharges: Record<string, unknown> = {}) {
  return {
    nom: 'Moulin de Statte',
    type: 'moulin' as const,
    email: 'contact@moulin-statte.be',
    telephone: null,
    adresse: null,
    delaiLivraisonJours: 3,
    francoDePortCents: null,
    commandeMinimumCents: null,
    notes: null,
    ...surcharges,
  };
}

/** Insere un ingredient de test et rend son identifiant. */
function insererIngredient(base: BaseBatte, nom: string): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(ingredient)
    .values({
      id,
      nom,
      categorie: 'garniture',
      uniteReference: 'g',
      allergenes: [],
      stockSecurite: 0,
      actif: true,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

/**
 * Insere une version de recette et rend son identifiant.
 *
 * `statut` reste `'active'` par defaut pour ne rien changer aux appels
 * existants ; un test peut le surcharger (`'brouillon'`) pour reproduire le
 * cas d'une recette jamais finie (`diagnostiquerRecettePourCoutNul`).
 */
function insererRecette(
  base: BaseBatte,
  code: string,
  version: number,
  nom: string,
  statut: 'brouillon' | 'active' | 'archivee' = 'active',
): string {
  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();
  base
    .insert(recette)
    .values({
      id,
      code,
      nom,
      version,
      statut,
      typePate: 'froment',
      sansGluten: false,
      rendementReferenceMl: 5000,
      rendementReferenceCrepes: 66,
      perteCuissonBp: 0,
      tauxCasseBp: 0,
      perteFixeMl: 0,
      creeLe: maintenant,
      modifieLe: maintenant,
    })
    .run();
  return id;
}

describe('dépôt référentiel — fournisseurs', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
  });

  it('crée un fournisseur actif et le journalise en « creation »', () => {
    const id = creerFournisseur(base, saisieFournisseur());

    const cree = listerFournisseurs(base).find((f) => f.id === id);
    expect(cree).toBeDefined();
    expect(cree?.nom).toBe('Moulin de Statte');
    expect(cree?.actif).toBe(true);

    const journal = listerJournalAudit(base, { table: 'fournisseur', enregistrementId: id });
    expect(journal).toHaveLength(1);
    expect(journal[0]?.action).toBe('creation');
  });

  it('conserve la valeur ANTÉRIEURE au journal lors d’une modification', () => {
    const id = creerFournisseur(base, saisieFournisseur({ delaiLivraisonJours: 3 }));
    modifierFournisseur(base, id, saisieFournisseur({ delaiLivraisonJours: 10 }));

    expect(listerFournisseurs(base).find((f) => f.id === id)?.delaiLivraisonJours).toBe(10);

    const modification = listerJournalAudit(base, {
      table: 'fournisseur',
      enregistrementId: id,
    }).find((entree) => entree.action === 'modification');

    expect(modification).toBeDefined();
    // Le coeur du test : l'ancien délai reste lisible après écrasement.
    expect(modification?.valeurAvant?.['delaiLivraisonJours']).toBe(3);
    expect(modification?.valeurApres?.['delaiLivraisonJours']).toBe(10);
  });

  it('lève une erreur 404 typée si l’identifiant modifié n’existe pas', () => {
    expect(() => modifierFournisseur(base, 'inconnu', saisieFournisseur())).toThrow(
      ErreurIntrouvable,
    );
    try {
      modifierFournisseur(base, 'inconnu', saisieFournisseur());
    } catch (erreur) {
      expect((erreur as ErreurMetier).statut).toBe(404);
    }
  });

  it('DÉSACTIVE sans rien supprimer : la ligne reste lisible', () => {
    const id = creerFournisseur(base, saisieFournisseur());
    const avant = listerFournisseurs(base).length;

    changerActiviteFournisseur(base, id, false);

    // La garantie réglementaire : une réception de 2026 référence ce
    // fournisseur, sa fiche doit rester lisible dix ans.
    const apres = listerFournisseurs(base);
    expect(apres).toHaveLength(avant);
    expect(apres.find((f) => f.id === id)?.actif).toBe(false);
  });

  it('permet de réactiver un fournisseur désactivé', () => {
    const id = creerFournisseur(base, saisieFournisseur());
    changerActiviteFournisseur(base, id, false);
    changerActiviteFournisseur(base, id, true);

    expect(listerFournisseurs(base).find((f) => f.id === id)?.actif).toBe(true);
  });

  it('journalise aussi la désactivation', () => {
    const id = creerFournisseur(base, saisieFournisseur());
    changerActiviteFournisseur(base, id, false);

    const entrees = listerJournalAudit(base, { table: 'fournisseur', enregistrementId: id });
    const desactivation = entrees.find(
      (entree) => entree.action === 'modification' && entree.valeurApres?.['actif'] === false,
    );
    expect(desactivation).toBeDefined();
    expect(desactivation?.valeurAvant?.['actif']).toBe(true);
  });

  it('compte 0 conditionnement pour un fournisseur qui n’en a aucun', () => {
    // Piège classique d'un GROUP BY sur jointure externe : il compterait 1.
    const id = creerFournisseur(base, saisieFournisseur());
    expect(listerFournisseurs(base).find((f) => f.id === id)?.nbConditionnements).toBe(0);
  });

  it('ne compte que les conditionnements ACTIFS', () => {
    const idFournisseur = creerFournisseur(base, saisieFournisseur());
    const idIngredient = insererIngredient(base, 'Farine T55');
    const maintenant = maintenantUtc();

    for (const actif of [true, true, false]) {
      base
        .insert(conditionnement)
        .values({
          id: nouvelIdentifiant(),
          ingredientId: idIngredient,
          fournisseurId: idFournisseur,
          libelle: 'Sac 25 kg',
          quantiteUniteRef: 25_000,
          prixCents: 1850,
          datePrix: '2026-07-01',
          actif,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
    }

    expect(listerFournisseurs(base).find((f) => f.id === idFournisseur)?.nbConditionnements).toBe(
      2,
    );
  });

  it('trie les fournisseurs par nom', () => {
    creerFournisseur(base, saisieFournisseur({ nom: 'Zèbre grossiste' }));
    creerFournisseur(base, saisieFournisseur({ nom: 'Ardenne ferme' }));

    expect(listerFournisseurs(base).map((f) => f.nom)).toEqual([
      'Ardenne ferme',
      'Zèbre grossiste',
    ]);
  });
});

/**
 * DÉFAUT TROUVÉ EN AUDIT (29/07/2026, chaîne d'achat) : ni `modifierFournisseur`
 * ni `changerActiviteFournisseur` ne vérifiaient que la cible n'est pas le
 * fournisseur SYSTÈME. `schemaSaisieFournisseur` (`contrats/referentiel.ts`)
 * n'accepte que les quatre types commerciaux : un `PATCH /fournisseurs/:id` sur
 * l'identifiant d'« Inventaire d'ouverture » écrivait donc `set({ ...saisie })`
 * et remplaçait SILENCIEUSEMENT son `type` par l'un des quatre types
 * commerciaux, en un seul appel API. Une fois ce champ basculé, toutes les
 * exclusions qui reposent sur `type === 'systeme'` — `conditionnementReference`
 * (`services/commandes.ts`, D-049), `verifierFournisseurCommercial`
 * (`referentiel-ecriture.ts`, `depots/economies.ts`) — cessaient de le
 * reconnaître : le fournisseur système devenait commandable comme n'importe
 * quel meunier, ce qui fausse en cascade la synthèse d'exercice et les
 * compteurs de seuils légaux qui s'appuient sur des achats réels.
 */
describe('dépôt référentiel — le fournisseur système ne se modifie jamais', () => {
  let base: BaseBatte;
  let idSysteme: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    seed(base);
    idSysteme = base
      .select({ id: fournisseur.id })
      .from(fournisseur)
      .where(eq(fournisseur.nom, FOURNISSEUR_INVENTAIRE_OUVERTURE))
      .get()!.id;
  });

  it('refuse `modifierFournisseur` sur le fournisseur système, avec un code dédié', () => {
    expect(() => modifierFournisseur(base, idSysteme, saisieFournisseur())).toThrow(ErreurMetier);
    try {
      modifierFournisseur(base, idSysteme, saisieFournisseur());
      expect.unreachable('devrait avoir levé une ErreurMetier');
    } catch (erreur) {
      const metier = erreur as ErreurMetier;
      expect(metier.code).toBe('fournisseur_systeme');
      expect(metier.statut).toBe(422);
    }
  });

  it(
    'CORRIGÉ : le type du fournisseur système ne bascule plus vers un type ' +
      'commercial — avant le correctif, cet appel réussissait et écrasait `type`',
    () => {
      expect(() =>
        modifierFournisseur(
          base,
          idSysteme,
          saisieFournisseur({ nom: FOURNISSEUR_INVENTAIRE_OUVERTURE }),
        ),
      ).toThrow(ErreurMetier);

      const encore = base.select().from(fournisseur).where(eq(fournisseur.id, idSysteme)).get()!;
      expect(encore.type).toBe('systeme');
    },
  );

  it('refuse `changerActiviteFournisseur` (désactivation) sur le fournisseur système', () => {
    expect(() => changerActiviteFournisseur(base, idSysteme, false)).toThrow(ErreurMetier);

    const encore = base.select().from(fournisseur).where(eq(fournisseur.id, idSysteme)).get()!;
    expect(encore.actif).toBe(true);
  });

  it('un fournisseur COMMERCIAL reste modifiable et désactivable normalement', () => {
    const idCommercial = creerFournisseur(base, saisieFournisseur());

    expect(() =>
      modifierFournisseur(base, idCommercial, saisieFournisseur({ nom: 'Moulin renommé' })),
    ).not.toThrow();
    expect(() => changerActiviteFournisseur(base, idCommercial, false)).not.toThrow();
    expect(listerFournisseurs(base).find((f) => f.id === idCommercial)?.actif).toBe(false);
  });
});

describe('dépôt référentiel — produits', () => {
  let base: BaseBatte;
  let idRecette: string;
  let idIngredient: string;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
    idRecette = insererRecette(base, 'R1', 2, 'Froment');
    idIngredient = insererIngredient(base, 'Sirop de Liège 450 g');
  });

  function produitTransforme() {
    return {
      nom: 'Froment / cassonade',
      nature: 'transforme' as const,
      recetteId: idRecette,
      ingredientId: null,
      prixCents: 300,
      consommationUnite: 'crepes' as const,
      nbCrepes: 1,
      volumeMlParUnite: null,
      categorie: 'sucrée',
      consommationSurPlace: false,
    };
  }

  function produitRevendu() {
    return {
      nom: 'Pot Sirop de Liège 450 g',
      nature: 'revendu' as const,
      recetteId: null,
      ingredientId: idIngredient,
      prixCents: 750,
      // Pas de `consommationUnite` : un revendu ne consomme rien de la
      // production, la question ne se pose pas — la clé est OMETTABLE
      // (`.exactOptional()`), pas à renseigner par `null`.
      nbCrepes: null,
      volumeMlParUnite: null,
      categorie: 'terroir',
      consommationSurPlace: false,
    };
  }

  it('crée un transformé et compose le libellé de recette AVEC sa version', () => {
    const id = creerProduit(base, produitTransforme());

    const cree = listerProduits(base).find((p) => p.id === id);
    // La version fait partie du libellé : un produit pointe une VERSION précise
    // de recette, et deux versions du même code portent le même nom.
    expect(cree?.recetteLibelle).toBe('R1 v2 — Froment');
    expect(cree?.ingredientNom).toBeNull();
    expect(cree?.nature).toBe('transforme');
  });

  it('crée un revendu et remonte le nom de l’article acheté', () => {
    const id = creerProduit(base, produitRevendu());

    const cree = listerProduits(base).find((p) => p.id === id);
    expect(cree?.ingredientNom).toBe('Sirop de Liège 450 g');
    expect(cree?.recetteLibelle).toBeNull();
    expect(cree?.nature).toBe('revendu');
  });

  it('refuse une recette inexistante par un 422 désignant le champ', () => {
    expect(() => creerProduit(base, { ...produitTransforme(), recetteId: 'inconnue' })).toThrow(
      ErreurMetier,
    );
    try {
      creerProduit(base, { ...produitTransforme(), recetteId: 'inconnue' });
    } catch (erreur) {
      const metier = erreur as ErreurMetier;
      expect(metier.statut).toBe(422);
      expect(metier.champs?.['recetteId']).toBeDefined();
    }
  });

  it('refuse un article revendu inexistant par un 422 désignant le champ', () => {
    try {
      creerProduit(base, { ...produitRevendu(), ingredientId: 'inconnu' });
      throw new Error('La création aurait dû échouer.');
    } catch (erreur) {
      const metier = erreur as ErreurMetier;
      expect(metier.statut).toBe(422);
      expect(metier.champs?.['ingredientId']).toBeDefined();
    }
  });

  it('n’écrit RIEN quand le rattachement est refusé', () => {
    try {
      creerProduit(base, { ...produitTransforme(), recetteId: 'inconnue' });
    } catch {
      // Attendu : on vérifie seulement qu'aucune ligne partielle ne subsiste.
    }
    expect(listerProduits(base)).toHaveLength(0);
  });

  it('conserve la valeur antérieure au journal lors d’un changement de prix', () => {
    const id = creerProduit(base, produitTransforme());
    modifierProduit(base, id, { ...produitTransforme(), prixCents: 350 });

    const modification = listerJournalAudit(base, {
      table: 'produit_vente',
      enregistrementId: id,
    }).find((entree) => entree.action === 'modification');

    expect(modification?.valeurAvant?.['prixCents']).toBe(300);
    expect(modification?.valeurApres?.['prixCents']).toBe(350);
  });

  it('permet de basculer un produit d’une nature à l’autre', () => {
    const id = creerProduit(base, produitTransforme());
    modifierProduit(base, id, produitRevendu());

    const apres = listerProduits(base).find((p) => p.id === id);
    expect(apres?.nature).toBe('revendu');
    expect(apres?.recetteId).toBeNull();
    expect(apres?.ingredientId).toBe(idIngredient);
  });

  it('lève une erreur 404 typée si le produit modifié n’existe pas', () => {
    expect(() => modifierProduit(base, 'inconnu', produitTransforme())).toThrow(ErreurIntrouvable);
  });

  it('RETIRE DE LA VENTE sans rien supprimer : le produit reste lisible', () => {
    const id = creerProduit(base, produitTransforme());
    changerActiviteProduit(base, id, false);

    // La garantie réglementaire : ce produit figure dans des sessions
    // clôturées, qui sont des pièces comptables.
    const apres = listerProduits(base);
    expect(apres).toHaveLength(1);
    expect(apres[0]?.actif).toBe(false);
  });

  it('permet de remettre en vente un produit retiré', () => {
    const id = creerProduit(base, produitTransforme());
    changerActiviteProduit(base, id, false);
    changerActiviteProduit(base, id, true);

    expect(listerProduits(base).find((p) => p.id === id)?.actif).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Audit référentiel du 29/07/2026 — coût matière d'un ingrédient SANS
   conditionnement actif (`depots/recettes.ts::coutsDeReference`).

   CORRIGÉ (second passage, même jour). VÉRIFIÉ PAR LECTURE DE CODE, pas
   supposé : `coutsDeReference` (et sa quasi-jumelle `coutsUnitaires` de
   `depots/referentiel-ecriture.ts`) construisent une `Map<ingredientId,
   tauxCents>` qui NE CONTIENT PAS les ingrédients sans conditionnement actif.
   Les deux consommateurs de `depots/recettes.ts` — `chargerRecettePourCalcul`
   (donc `mettreAEchelle`, donc `coutParCrepe`, donc
   `coutMatiereCents`/`coutParCrepeCents` affichés sur l'écran Recettes) et
   `garnituresDuProduit` (donc `coutRevientProduit`, donc la marge de l'écran
   Produits) — lisaient cette carte avec `couts.get(id) ?? 0` : un ingrédient
   dont le prix n'est pas encore connu était donc traité comme GRATUIT,
   silencieusement, au lieu d'un coût INCONNU (`null`). C'est exactement le
   défaut que D-018 corrige pour le CUMP (« un ingrédient épuisé n'a pas un
   coût de zéro, il n'a pas de coût ») et que `schemaResultatCalcul.coutParCrepeCents`
   documente lui-même (`packages/core/src/contrats/recettes.ts` : « un 0
   tirerait le coût moyen vers le bas ») — sauf qu'ici le même raisonnement
   N'ÉTAIT PAS appliqué au niveau de la LIGNE.

   ATTEIGNABLE PAR LE CHEMIN PRINCIPAL DE L'ÉCRAN, pas un cas d'école : la
   création rapide d'ingrédient de `Recettes.tsx` (fiche 09,
   `creerIngredientRapide`) crée l'ingrédient PUIS l'assigne immédiatement à la
   ligne de recette qui a ouvert le formulaire, SANS jamais créer de
   conditionnement — le commentaire du composant le dit lui-même :
   « ils se complètent ensuite depuis l'écran Ingrédients ». Tant que ce
   second geste n'est pas fait, l'ingrédient tout juste ajouté à une recette
   comptait pour 0 € dans son coût matière, sans qu'aucun message ne le
   signale dans le calcul.

   CORRECTIF APPLIQUÉ : `coutsDeReference(...).get(id) ?? null` (jamais `?? 0`)
   dans les trois lectures de `depots/recettes.ts`. `null` remonte désormais
   ligne par ligne jusqu'au total (même famille que `coutProduitVendu`, qui
   sait déjà distinguer « base manquante » de « base à zéro ») : la forme de
   `LigneRecetteCalcul.cumpCentsParUnite` (`packages/core/src/recettes.ts`) et
   du contrat HTTP `schemaLigneRecette`/`schemaResultatCalcul`
   (`packages/core/src/contrats/recettes.ts`) sont désormais `number | null`,
   et l'écran (`Recettes.tsx`) affiche « Coût inconnu : prix manquant sur… »
   au lieu de « 0,00 € ».
   ═══════════════════════════════════════════════════════════════════════════ */
describe('dépôt référentiel — coût matière d’un ingrédient sans conditionnement (audit 29/07/2026)', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
  });

  it('un ingrédient SANS conditionnement actif rend un coût INCONNU (null), jamais GRATUIT (0), dans le calcul d’une recette', () => {
    const idRecette = insererRecette(base, 'R1', 1, 'Froment');
    const idFarine = insererIngredient(base, 'Farine T55');
    // Jamais de conditionnement créé pour celui-ci : exactement le cas de la
    // création rapide d'ingrédient (fiche 09) avant le passage par l'écran
    // Ingrédients.
    const idCannelle = insererIngredient(base, 'Cannelle');

    const idFournisseur = creerFournisseur(base, saisieFournisseur());
    const maintenant = maintenantUtc();
    base
      .insert(conditionnement)
      .values({
        id: nouvelIdentifiant(),
        ingredientId: idFarine,
        fournisseurId: idFournisseur,
        libelle: 'Sac 25 kg',
        quantiteUniteRef: 25_000,
        prixCents: 1875,
        datePrix: '2026-07-01',
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();

    base
      .insert(recetteLigne)
      .values([
        {
          id: nouvelIdentifiant(),
          recetteId: idRecette,
          ingredientId: idFarine,
          quantiteUniteRef: 145,
          ordre: 0,
          noteTechnique: null,
        },
        {
          id: nouvelIdentifiant(),
          recetteId: idRecette,
          ingredientId: idCannelle,
          quantiteUniteRef: 20,
          ordre: 1,
          noteTechnique: null,
        },
      ])
      .run();

    const pourCalcul = chargerRecettePourCalcul(base, idRecette);
    const ligneCannelle = pourCalcul?.lignes.find((l) => l.ingredientId === idCannelle);

    // Le défaut, avant correctif : `ligneCannelle` existe (la ligne de
    // recette, elle, est bien là), mais son coût unitaire valait exactement
    // 0 — indiscernable d'un ingrédient réellement gratuit, alors qu'aucun
    // prix n'a jamais été renseigné pour la cannelle. Il vaut désormais
    // exactement `null`.
    expect(ligneCannelle?.cumpCentsParUnite).not.toBe(0);
    expect(ligneCannelle?.cumpCentsParUnite).toBeNull();

    // Propagation jusqu'à l'écran : le coût de la fournée entière devient
    // INCONNU (jamais la seule farine, sous-évaluée en silence) — vérifié par
    // `lireRecetteDetail`, exactement ce que `GET /recettes/:id` sert à
    // l'écran Recettes.
    const detail = lireRecetteDetail(base, idRecette);
    expect(detail?.coutParCrepeCents).toBeNull();
  });
});

/**
 * Audit du 30/07/2026 — second trou de la mission « marge brute à 100 % sans
 * qu'aucun champ ne le signale » : `verifierRattachements` ne vérifie que
 * l'EXISTENCE de la recette référencée par un produit transformé, jamais son
 * statut ni son nombre de lignes. `diagnostiquerRecettePourCoutNul` comble ce
 * trou EN LECTURE SEULE, pour la clôture de session
 * (`services/sessions.ts::cloturerSession`) — jamais pour bloquer la création
 * ou la modification d'un produit, qui reste un ordre de travail légitime tant
 * que sa recette n'est pas terminée.
 */
describe('dépôt référentiel — diagnostiquerRecettePourCoutNul (audit 30/07/2026)', () => {
  let base: BaseBatte;

  beforeEach(() => {
    base = creerBase(':memory:');
    migrer(base);
  });

  it('rend `null` quand la recette n’existe pas (jamais atteint en pratique, mais jamais une exception)', () => {
    expect(diagnostiquerRecettePourCoutNul(base, 'inconnue')).toBeNull();
  });

  it('signale une recette en BROUILLON avec zéro ligne — le cas exact « jamais activée, jamais garnie »', () => {
    const idRecette = insererRecette(base, 'R9', 1, 'Recette test vide', 'brouillon');

    const diagnostic = diagnostiquerRecettePourCoutNul(base, idRecette);

    expect(diagnostic).not.toBeNull();
    expect(diagnostic?.statut).toBe('brouillon');
    expect(diagnostic?.nbLignes).toBe(0);
    expect(diagnostic?.libelle).toBe('R9 v1 — Recette test vide');
  });

  it('rend le vrai nombre de lignes pour une recette active et garnie', () => {
    const idRecette = insererRecette(base, 'R1', 1, 'Froment');
    const idFarine = insererIngredient(base, 'Farine T55');
    base
      .insert(recetteLigne)
      .values({
        id: nouvelIdentifiant(),
        recetteId: idRecette,
        ingredientId: idFarine,
        quantiteUniteRef: 145,
        ordre: 0,
        noteTechnique: null,
      })
      .run();

    const diagnostic = diagnostiquerRecettePourCoutNul(base, idRecette);

    expect(diagnostic?.statut).toBe('active');
    expect(diagnostic?.nbLignes).toBe(1);
  });
});
