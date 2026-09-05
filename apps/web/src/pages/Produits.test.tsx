import { describe, expect, it } from 'vitest';
import {
  TIRET_ABSENT,
  formaterMontant,
  formaterPourcent,
  type CoutProduitVenduContrat,
} from '@batte/core';
import {
  affichageCoutRevientProduit,
  corpsSaisieProduit,
  erreursSaisieProduit,
  type Brouillon,
} from './Produits';

/**
 * Câblage de la nature `menu` (mission du 30/07/2026) : `changerNature`
 * (`Produits.tsx`) était typée sur `NatureProduit` — le type à DEUX valeurs de
 * `packages/core/src/sessions.ts` — donc le formulaire ne pouvait poser que
 * `transforme` ou `revendu`, jamais `menu`, alors que `schemaNatureProduit`
 * (`packages/core/src/contrats/referentiel.ts`) en accepte trois depuis la
 * migration 0023. Toute la machinerie d'éclatement d'un menu à la clôture
 * (`packages/db/src/services/sessions.ts`) ne se déclenche QUE sur
 * `nature === 'menu'` : un produit qu'on ne peut pas créer avec cette nature
 * ne peut jamais l'atteindre.
 *
 * `corpsSaisieProduit` est la fonction PURE extraite de la construction du
 * corps envoyé à `POST /produits` / `PATCH /produits/:id` : elle prouve, sans
 * monter tout l'écran (le montage vit dans `Produits.montage.test.tsx`), que
 * choisir « Menu » produit bien
 * `nature: 'menu'` avec `recetteId` et `ingredientId` à `null` — jamais une
 * valeur orpheline d'une nature précédente, exactement ce que
 * `verifierCoherenceProduit` (`packages/core/src/contrats/referentiel.ts`)
 * exige d'un menu.
 */

const BROUILLON_TRANSFORME: Brouillon = {
  nom: 'Crêpe froment nature',
  nature: 'transforme',
  consommationUnite: 'crepes',
  recetteId: 'recette-r1',
  ingredientId: '',
  prix: '3,50',
  nbCrepes: '1',
  volumeMlParUnite: '',
  categorie: 'crêpe',
  consommationSurPlace: false,
};

describe('corpsSaisieProduit — la nature menu, jusqu’ici inatteignable, peut enfin se créer', () => {
  it('envoie nature: "menu" avec recetteId, ingredientId, consommationUnite et nbCrepes à null', () => {
    const brouillonMenu: Brouillon = {
      nom: 'Menu crêpe + café',
      nature: 'menu',
      consommationUnite: '',
      recetteId: '',
      ingredientId: '',
      prix: '5,00',
      nbCrepes: '',
      volumeMlParUnite: '',
      categorie: '',
      consommationSurPlace: false,
    };

    const corps = corpsSaisieProduit(brouillonMenu);

    expect(corps).toMatchObject({
      nom: 'Menu crêpe + café',
      nature: 'menu',
      recetteId: null,
      ingredientId: null,
      prixCents: 500,
      consommationUnite: null,
      nbCrepes: null,
      volumeMlParUnite: null,
    });
  });

  it('purge recetteId, ingredientId, consommationUnite et nbCrepes pour un menu même si le brouillon en porte encore (bascule depuis transformé)', () => {
    // Un utilisateur qui bascule « Transformé » -> « Menu » sans repasser par
    // `changerNature` (ou un brouillon reconstruit à la main dans un test)
    // porterait encore un `recetteId`, un `consommationUnite` et un
    // `nbCrepes` d'une nature précédente : la fonction pure doit rester le
    // dernier filet, pas seulement `changerNature`.
    const corps = corpsSaisieProduit({ ...BROUILLON_TRANSFORME, nature: 'menu' });

    expect(corps).toMatchObject({
      nature: 'menu',
      recetteId: null,
      ingredientId: null,
      consommationUnite: null,
      nbCrepes: null,
      volumeMlParUnite: null,
    });
  });

  it('conserve le comportement existant pour un produit transformé « crêpes » (non-régression)', () => {
    const corps = corpsSaisieProduit(BROUILLON_TRANSFORME);

    expect(corps).toMatchObject({
      nom: 'Crêpe froment nature',
      nature: 'transforme',
      recetteId: 'recette-r1',
      ingredientId: null,
      prixCents: 350,
      consommationUnite: 'crepes',
      nbCrepes: 1,
      volumeMlParUnite: null,
      categorie: 'crêpe',
      consommationSurPlace: false,
    });
  });

  it('conserve le comportement existant pour un produit revendu (non-régression)', () => {
    const corps = corpsSaisieProduit({
      ...BROUILLON_TRANSFORME,
      nature: 'revendu',
      recetteId: '',
      ingredientId: 'ingredient-sirop',
      nbCrepes: '',
    });

    expect(corps).toMatchObject({
      nature: 'revendu',
      recetteId: null,
      ingredientId: 'ingredient-sirop',
      consommationUnite: null,
      nbCrepes: null,
      volumeMlParUnite: null,
    });
  });

  /**
   * LA VRAIE QUESTION (fiche 15 §4/§5.1, décision du porteur du 31/07/2026) :
   * la pâte vendue au volume n'est plus identifiée par une déduction sur
   * `nbCrepes === 0`, mais par `consommationUnite === 'volume_pate'` choisi
   * explicitement. `nbCrepes` reste néanmoins figé à `0` par
   * `corpsSaisieProduit` — la MÊME valeur qu'avant cette refonte, pour la
   * même raison (« cette unité ne produit aucune crêpe »).
   */
  it('envoie consommationUnite: "volume_pate" avec nbCrepes à 0 et le volume renseigné', () => {
    const corps = corpsSaisieProduit({
      ...BROUILLON_TRANSFORME,
      consommationUnite: 'volume_pate',
      nbCrepes: '0',
      volumeMlParUnite: '500',
    });

    expect(corps).toMatchObject({
      nature: 'transforme',
      consommationUnite: 'volume_pate',
      nbCrepes: 0,
      volumeMlParUnite: 500,
    });
  });

  /**
   * LE CAFÉ (fiche 15 §4) : un transformé À LA DEMANDE, dont la composition
   * vient entièrement de la nomenclature de vente. `nbCrepes` reste figé à
   * `0` (même raison que ci-dessus), et `volumeMlParUnite` reste `null` —
   * même si le champ de suite masqué portait encore une ancienne valeur.
   */
  it('envoie consommationUnite: "nomenclature" (le café) avec nbCrepes à 0 et aucun volume, quoi que porte le champ masqué', () => {
    const corps = corpsSaisieProduit({
      ...BROUILLON_TRANSFORME,
      consommationUnite: 'nomenclature',
      nbCrepes: '7',
      volumeMlParUnite: '500',
    });

    expect(corps).toMatchObject({
      nature: 'transforme',
      consommationUnite: 'nomenclature',
      nbCrepes: 0,
      volumeMlParUnite: null,
    });
  });
});

/**
 * Retour de focus après un échec d'enregistrement (mission du 30/07/2026,
 * reproduit avec un prix de vente vide) : sur Ingrédients et Lieux de marché,
 * le focus revient sur le premier champ en erreur après un refus. Sur
 * Produits, `corpsDepuisBrouillon` posait déjà `champsEnErreur` mais
 * n'appelait jamais `focaliserPremierChampFautif` : le focus restait sur le
 * bouton « Enregistrer », sans rien qui guide vers le champ fautif.
 *
 * `erreursSaisieProduit` est la fonction PURE extraite de cette validation
 * locale : ces tests prouvent qu'elle désigne le bon champ EN PREMIER — celui
 * que `corpsDepuisBrouillon` (désormais) transmet à
 * `focaliserPremierChampFautif` juste après `setChampsEnErreur`, exactement
 * comme `Ingredients.tsx` et `LieuxMarche.tsx`.
 */
describe('erreursSaisieProduit — le champ que le focus doit atteindre en premier', () => {
  it('signale un prix de vente vide sous `prixCents`', () => {
    const erreurs = erreursSaisieProduit({ ...BROUILLON_TRANSFORME, prix: '' });
    expect(Object.keys(erreurs)[0]).toBe('prixCents');
  });

  it('signale un nombre de crêpes illisible sous `nbCrepes`, sur un transformé', () => {
    const erreurs = erreursSaisieProduit({ ...BROUILLON_TRANSFORME, nbCrepes: 'abc' });
    expect(Object.keys(erreurs)[0]).toBe('nbCrepes');
  });

  it('signale un volume manquant sous `volumeMlParUnite`, pour de la pâte vendue au volume', () => {
    const erreurs = erreursSaisieProduit({
      ...BROUILLON_TRANSFORME,
      consommationUnite: 'volume_pate',
      nbCrepes: '0',
      volumeMlParUnite: '',
    });
    expect(Object.keys(erreurs)[0]).toBe('volumeMlParUnite');
  });

  it('signale sous `consommationUnite` un transformé qui ne précise pas ce qu’une unité vendue consomme', () => {
    const erreurs = erreursSaisieProduit({ ...BROUILLON_TRANSFORME, consommationUnite: '' });
    expect(Object.keys(erreurs)[0]).toBe('consommationUnite');
  });

  it('ne signale rien pour un café (« nomenclature »), qui n’a ni crêpes ni volume à saisir', () => {
    expect(
      erreursSaisieProduit({
        ...BROUILLON_TRANSFORME,
        consommationUnite: 'nomenclature',
        nbCrepes: '0',
        volumeMlParUnite: '',
      }),
    ).toEqual({});
  });

  it('ne signale rien pour un brouillon valide', () => {
    expect(erreursSaisieProduit(BROUILLON_TRANSFORME)).toEqual({});
  });
});

/**
 * Défaut trouvé par audit (30/07/2026) : `GET /couts-produits` et
 * `GET /produits/:id/cout-revient` (`apps/api/src/routes/recettes.ts:110-119`)
 * calculent le coût de revient et la marge de chaque produit vendu — testées,
 * servies — mais `Produits.tsx` n'appelait ni l'une ni l'autre. La liste
 * n'affichait que nom, nature, prix et statut : aucune marge nulle part.
 *
 * `affichageCoutRevientProduit` est la fonction PURE extraite de la fiche qui
 * décide comment écrire ce que la route rend — même patron que
 * `erreursSaisieProduit` ci-dessus, ce fichier ne montant pas l'écran.
 *
 * LE TEST QUI COMPTE : un coût de revient INCONNU (recette vide, ingrédient
 * jamais réceptionné, article revendu sans conditionnement actif) ne doit
 * JAMAIS s'afficher comme `0,00` — ce serait fabriquer une marge à 100 %,
 * exactement le mensonge que `avertissementCoutMatiereTransforme`
 * (`packages/db/src/services/sessions.ts`) existe déjà pour signaler à la
 * clôture d'une session.
 */
describe('affichageCoutRevientProduit', () => {
  function coutConnu(overrides: Partial<CoutProduitVenduContrat> = {}): CoutProduitVenduContrat {
    // Valeurs de référence R1 (CLAUDE.md §6) : ≈ 0,33 €/crêpe, prix 3,50 €,
    // donc une marge d'environ 91 % — un jeu de données réaliste plutôt que
    // des nombres arbitraires.
    return {
      produitVenteId: 'produit-crepe-nature',
      nom: 'Crêpe froment nature',
      nature: 'transforme',
      prixVenteCents: 350,
      coutPateCents: 33,
      coutAchatCents: 0,
      coutGarnituresCents: 0,
      // Nomenclature de vente (01/08/2026) : une crêpe `transforme` n'a pas de
      // composants vendus — ce qu'elle consomme est dans sa RECETTE, pas dans
      // `produit_vente_composant`. Zéro et liste vide sont donc des faits ici,
      // pas des inconnues déguisées en zéro : un produit à nomenclature, lui,
      // rend `null` quand un composant n'a jamais été acheté.
      coutComposantsCents: 0,
      composants: [],
      coutMatiereCents: 33,
      margeCents: 317,
      margeBp: 9057,
      garnitures: [],
      allergenes: [],
      ...overrides,
    };
  }

  it('affiche un coût de revient et une marge connus, sans avertissement', () => {
    const affichage = affichageCoutRevientProduit('transforme', coutConnu());

    expect(affichage.coutMatiere).toBe(formaterMontant(33));
    expect(affichage.marge).toBe(formaterMontant(317));
    expect(affichage.margeTaux).toBe(formaterPourcent(9057));
    expect(affichage.avertissement).toBeNull();
  });

  it('ROUGE avant le correctif : un coût de revient inconnu ne s’affiche jamais comme 0,00', () => {
    // Recette vide ou ingrédient sans conditionnement actif : `coutMatiereCents`
    // et `margeCents` valent `null` côté serveur (`coutProduitVendu`,
    // `packages/core/src/recettes.ts`). Une version naïve qui écrirait
    // `cout.coutMatiereCents ?? 0` afficherait ici « 0,00 » et une marge de
    // 100 % — exactement le défaut de la mission.
    const affichage = affichageCoutRevientProduit(
      'transforme',
      coutConnu({ coutMatiereCents: null, margeCents: null, margeBp: null }),
    );

    expect(affichage.coutMatiere).toBe(TIRET_ABSENT);
    expect(affichage.coutMatiere).not.toBe('0,00');
    expect(affichage.marge).toBe(TIRET_ABSENT);
    expect(affichage.margeTaux).toBe(TIRET_ABSENT);
    expect(affichage.avertissement).not.toBeNull();
  });

  it('distingue ce coût inconnu d’un coût réellement nul (les deux ne s’écrivent pas pareil)', () => {
    // Symétrique du test précédent : un coût de revient qui vaut VRAIMENT
    // zéro (composante gratuite, cas limite mais licite) doit rester lisible
    // comme un zéro, pas disparaître derrière le même tiret qu'un inconnu.
    const affichage = affichageCoutRevientProduit(
      'revendu',
      coutConnu({
        nature: 'revendu',
        coutAchatCents: 0,
        coutMatiereCents: 0,
        margeCents: 350,
        margeBp: 10000,
      }),
    );

    expect(affichage.coutMatiere).toBe('0,00');
    expect(affichage.coutMatiere).not.toBe(TIRET_ABSENT);
    expect(affichage.avertissement).toBeNull();
  });

  it('nomme la recette pour un transforme au cout inconnu, jamais un conditionnement d’achat', () => {
    const affichage = affichageCoutRevientProduit(
      'transforme',
      coutConnu({ coutMatiereCents: null, margeCents: null, margeBp: null }),
    );

    expect(affichage.avertissement).toContain('recette');
  });

  it('nomme le conditionnement d’achat pour un revendu au cout inconnu, jamais une recette', () => {
    const affichage = affichageCoutRevientProduit(
      'revendu',
      coutConnu({
        nature: 'revendu',
        coutMatiereCents: null,
        margeCents: null,
        margeBp: null,
      }),
    );

    expect(affichage.avertissement).toContain('achat');
    expect(affichage.avertissement).not.toContain('recette');
  });

  it('un menu n’affiche jamais de coût numérique, même si la liste en portait un par erreur', () => {
    // `schemaCoutProduitVendu` exclut `menu` de `nature` : ce cas ne devrait
    // jamais arriver en pratique. Le test prouve que même si l'appelant
    // fournissait quand même une ligne, elle est ignorée pour un menu — la
    // décision se prend sur la nature du PRODUIT, jamais sur ce que la route
    // a répondu.
    const affichage = affichageCoutRevientProduit('menu', coutConnu());

    expect(affichage.coutMatiere).toBe(TIRET_ABSENT);
    expect(affichage.marge).toBe(TIRET_ABSENT);
    expect(affichage.margeTaux).toBe(TIRET_ABSENT);
    expect(affichage.avertissement).not.toBeNull();
    expect(affichage.avertissement).toContain('Menus');
  });

  it('un menu sans aucune ligne dans la liste se comporte exactement pareil (cas réel)', () => {
    // `listerCoutsRevientProduits` omet les menus de la liste : c'est le cas
    // qui se produit réellement, contrairement au précédent.
    const affichage = affichageCoutRevientProduit('menu', undefined);

    expect(affichage.coutMatiere).toBe(TIRET_ABSENT);
    expect(affichage.avertissement).toContain('Menus');
  });

  it('ne fabrique aucun avertissement quand la ligne manque simplement (route pas encore chargée)', () => {
    // Absence de donnée, pas donnée disant « inconnu » : ce sont deux
    // situations différentes, la seconde seule justifie un message.
    const affichage = affichageCoutRevientProduit('transforme', undefined);

    expect(affichage.coutMatiere).toBe(TIRET_ABSENT);
    expect(affichage.avertissement).toBeNull();
  });

  /**
   * LA TROISIÈME CAUSE (mission du 01/08/2026, `composants[].cumpCentsParUnite:
   * null`) : un composant de nomenclature de vente (gobelet, café en poudre…)
   * jamais acheté. Avant ce correctif, `avertissementCoutRevientInconnu` ne
   * connaissait que « recette vide » et « ingrédient sans conditionnement » —
   * un café dont la recette est délibérément vide (D-085) aurait été envoyé
   * à tort vers l'écran Recettes.
   */
  it('nomme le composant de nomenclature de vente fautif, jamais la recette, quand c’est la vraie cause', () => {
    const affichage = affichageCoutRevientProduit(
      'transforme',
      coutConnu({
        coutComposantsCents: null,
        coutMatiereCents: null,
        margeCents: null,
        margeBp: null,
        composants: [
          {
            ingredientId: 'ing-gobelet',
            nomIngredient: 'Gobelet carton',
            unite: 'piece',
            quantiteUniteRef: 1,
            quantiteReferenceUnites: 1,
            cumpCentsParUnite: null,
            coutCents: null,
            allergenes: [],
            optionnel: false,
            consommationSurPlace: null,
            inclusDansLeCout: true,
          },
        ],
      }),
    );

    expect(affichage.avertissement).toContain('Gobelet carton');
    expect(affichage.avertissement).not.toContain('recette');
  });

  it('ignore un composant sans prix qui n’est PAS inclus dans le total (option, ou mode différent)', () => {
    // Un composant exclu (optionnel, ou réservé à un autre mode de
    // consommation) ne cause jamais un coût inconnu : lui donner la parole
    // désignerait le mauvais coupable. Le message générique reste donc celui
    // qui s'applique.
    const affichage = affichageCoutRevientProduit(
      'transforme',
      coutConnu({
        coutMatiereCents: null,
        margeCents: null,
        margeBp: null,
        composants: [
          {
            ingredientId: 'ing-creme',
            nomIngredient: 'Crème',
            unite: 'ml',
            quantiteUniteRef: 15,
            quantiteReferenceUnites: 1,
            cumpCentsParUnite: null,
            coutCents: null,
            allergenes: ['lait'],
            optionnel: true,
            consommationSurPlace: null,
            inclusDansLeCout: false,
          },
        ],
      }),
    );

    expect(affichage.avertissement).not.toContain('Crème');
    expect(affichage.avertissement).toContain('recette');
  });
});
