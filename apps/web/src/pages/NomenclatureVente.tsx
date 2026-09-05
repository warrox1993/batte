import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  TIRET_ABSENT,
  formaterMontant,
  schemaListeIngredients,
  schemaListeProduits,
  type ComposantVente,
  type IngredientReferentiel,
  type ListeComposantsVente,
  type Produit,
} from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { champsEnErreurApresModification } from '../composants/formulaire';
import { MessageErreur } from '../composants/EncartErreur';
// Le libellé des trois natures vient de `Menus.tsx`, où le `switch` exhaustif
// vit déjà : cet écran portait la TROISIÈME instance du ternaire
// `transforme ? 'transformé' : 'revendu'`, qui annonçait un menu « revendu ».
// Les deux corrections précédentes avaient RECOPIÉ le `switch` au lieu de le
// partager — c'est précisément ce qui a permis à ce troisième site de
// survivre. On importe donc, on ne recopie plus.
import { libelleNature } from './Menus';
import { ErreurApi, requeteApi } from '../lib/api';

/**
 * Écran « Nomenclature de vente » (fiche 15) : ce qu'un produit consomme au
 * moment où il est VENDU — serviettes, gobelets, café en poudre, toppings
 * vendus à la pièce — par opposition à la recette, consommée à la
 * PRODUCTION.
 *
 * POURQUOI CET ÉCRAN EXISTE. La catégorie d'ingrédient `consommable` permet
 * déjà d'entrer des serviettes ou des gobelets en stock, mais rien ne les
 * faisait sortir : le stock gonflait indéfiniment, le point de commande ne se
 * déclenchait jamais, et le coût par crêpe les ignorait — exactement le
 * défaut des garnitures corrigé par D-053. Cet écran est le geste qui manquait
 * pour déclarer QUOI un produit consomme à la vente, en quelle quantité.
 *
 * LE PIÈGE QUE LE FORMULAIRE DOIT ÉVITER DE FAIRE COMMETTRE. La quantité est
 * un ENTIER (CLAUDE.md §3 règle 4) : une pincée de cannelle à 0,2 g par tasse
 * s'arrondirait à 0 et disparaîtrait sans bruit si on la saisissait « pour 1
 * café ». D'où le « lot de référence » — on saisit « pour 100 cafés : 20 g »,
 * exactement comme R1 est écrite « pour 6 crêpes : 145 g de farine ». Le coût
 * affiché porte donc sur le LOT DE RÉFÉRENCE entier, jamais divisé par unité :
 * diviser ferait réapparaître le même piège à l'écran, sous une autre forme.
 */

type EtatEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; produits: Produit[]; ingredients: IngredientReferentiel[] };

type EtatComposants =
  | { statut: 'inactif' }
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; composants: ComposantVente[] };

/** `'indifferent'` = `consommationSurPlace` à `null` : consomme dans les deux cas. */
type ModeConsommation = 'indifferent' | 'sur_place' | 'emporte';

export type Brouillon = {
  ingredientId: string;
  quantiteUniteRef: string;
  quantiteReferenceUnites: string;
  mode: ModeConsommation;
  /** `true` = option servie seulement sur demande (crème) ; `false` = toujours appliqué (gobelet). */
  optionnel: boolean;
};

const BROUILLON_VIDE: Brouillon = {
  ingredientId: '',
  quantiteUniteRef: '',
  quantiteReferenceUnites: '1',
  mode: 'indifferent',
  optionnel: false,
};

function versConsommationSurPlace(mode: ModeConsommation): boolean | null {
  if (mode === 'sur_place') return true;
  if (mode === 'emporte') return false;
  return null;
}

function versMode(consommationSurPlace: boolean | null): ModeConsommation {
  if (consommationSurPlace === true) return 'sur_place';
  if (consommationSurPlace === false) return 'emporte';
  return 'indifferent';
}

function libelleMode(mode: ModeConsommation): string {
  switch (mode) {
    case 'sur_place':
      return 'Sur place seulement';
    case 'emporte':
      return 'À emporter seulement';
    case 'indifferent':
      return 'Peu importe';
  }
}

/**
 * Validation LOCALE du brouillon, avant tout aller-retour — même patron que
 * `erreursSaisieProduit` (`Produits.tsx`), `erreursSaisieConcurrent`
 * (`Concurrents.tsx`) et `erreursSaisieFournisseur` (`Fournisseurs.tsx`).
 *
 * Extraite en fonction PURE et exportée pour prouver, sans monter tout
 * l'écran, quel champ un ingrédient non choisi ou une quantité
 * illisible désigne EN PREMIER — c'est ce nom de champ que
 * `focaliserPremierChampFautif` doit atteindre juste après
 * `setChampsEnErreur` (défaut mesuré le 30/07/2026 : cet appel manquait ici,
 * le focus restait sur le bouton « Enregistrer »).
 */
export function erreursSaisieComposantVente(brouillon: Brouillon): Record<string, string> {
  const erreurs: Record<string, string> = {};

  if (brouillon.ingredientId === '') {
    erreurs['ingredientId'] = 'Choisissez un ingrédient.';
  }

  if (!/^\d+$/.test(brouillon.quantiteUniteRef.trim())) {
    erreurs['quantiteUniteRef'] = 'Indiquez un nombre entier strictement positif.';
  } else if (Number.parseInt(brouillon.quantiteUniteRef.trim(), 10) <= 0) {
    erreurs['quantiteUniteRef'] = 'La quantité doit être positive.';
  }

  const saisieReference = brouillon.quantiteReferenceUnites.trim();
  if (!/^\d+$/.test(saisieReference)) {
    erreurs['quantiteReferenceUnites'] = 'Indiquez un nombre entier strictement positif.';
  } else if (Number.parseInt(saisieReference, 10) <= 0) {
    erreurs['quantiteReferenceUnites'] = 'Le lot de référence doit être positif.';
  }

  return erreurs;
}

function heureCourante(): string {
  return new Intl.DateTimeFormat('fr-BE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Brussels',
  }).format(new Date());
}

/**
 * Coût indicatif pour le LOT DE RÉFÉRENCE ENTIER (jamais divisé par unité).
 *
 * `composant.coutIndicatifCentsParUnite` est un taux PAR UNITÉ VENDUE,
 * délibérément non arrondi côté serveur : diviser la cannelle par café donne
 * 0,3 centime, qui s'afficherait « 0,00 € » et ferait croire à un composant
 * gratuit. En le multipliant par `quantiteReferenceUnites`, on retrouve le
 * coût du lot de référence complet (« pour 100 cafés »), qui est le nombre
 * que le porteur pense réellement.
 *
 * `null`, jamais `0`, quand `coutIndicatifCentsParUnite` l'est déjà : un
 * composant jamais acheté (aucun conditionnement actif sur son ingrédient) a
 * un prix INCONNU, pas gratuit. C'est le défaut exact que ce champ corrige —
 * un `?? 0` en amont rendait ce cas indiscernable d'un composant réellement
 * offert, donc une marge de 100 % à l'écran. Voir la colonne « cout » de
 * `COLONNES` ci-dessous, qui écrit « Prix inconnu » plutôt que « 0,00 € ».
 *
 * Exportée pour rester testable sans monter l'écran — même patron que
 * `erreursSaisieComposantVente` ci-dessus. Le rendu du tableau où ce coût
 * s'affiche est couvert par `NomenclatureVente.montage.test.tsx`.
 */
export function coutLotReferenceCents(composant: ComposantVente): number | null {
  return composant.coutIndicatifCentsParUnite === null
    ? null
    : Math.round(composant.coutIndicatifCentsParUnite * composant.quantiteReferenceUnites);
}

export default function NomenclatureVente() {
  // Pont depuis l'écran Produits (`?produit=<id>`) : créer un café ou une
  // pâte vendue puis devoir le rechercher une seconde fois dans ce sélecteur
  // serait exactement l'inconfort que la fiche 15 demande de lever.
  const [searchParams] = useSearchParams();
  const produitDemandeAppliqueRef = useRef(false);

  const [etat, setEtat] = useState<EtatEcran>({ statut: 'chargement' });
  const [produitId, setProduitId] = useState<string>('');
  const [composantsEtat, setComposantsEtat] = useState<EtatComposants>({ statut: 'inactif' });
  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [brouillon, setBrouillon] = useState<Brouillon>(BROUILLON_VIDE);
  const [champsEnErreur, setChampsEnErreur] = useState<Record<string, string>>({});
  const [erreurFormulaire, setErreurFormulaire] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState<
    'inchange' | 'enregistrement' | 'enregistre'
  >('inchange');
  const [heureEnregistrement, setHeureEnregistrement] = useState<string | null>(null);

  const formulaireRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let annule = false;

    Promise.all([
      requeteApi<unknown>('/produits').then((r) => schemaListeProduits.parse(r).data),
      requeteApi<unknown>('/ingredients').then((r) => schemaListeIngredients.parse(r).data),
    ])
      .then(([produits, ingredients]) => {
        if (annule) return;
        setEtat({ statut: 'pret', produits, ingredients });
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        setEtat({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi
              ? erreur.message
              : 'Erreur inattendue, sans plus de détail.',
        });
      });

    return () => {
      annule = true;
    };
  }, []);

  // Applique `?produit=<id>` UNE SEULE FOIS, dès que la liste est chargée : au
  // delà, c'est l'utilisateur qui choisit, jamais l'URL qui reprend la main
  // sur une sélection déjà faite à la main.
  useEffect(() => {
    if (produitDemandeAppliqueRef.current || etat.statut !== 'pret') return;
    const produitDemande = searchParams.get('produit');
    if (produitDemande === null) return;
    produitDemandeAppliqueRef.current = true;
    if (etat.produits.some((p) => p.id === produitDemande)) {
      setProduitId(produitDemande);
    }
  }, [etat, searchParams]);

  const produits = useMemo(() => (etat.statut === 'pret' ? etat.produits : []), [etat]);
  const ingredients = useMemo(() => (etat.statut === 'pret' ? etat.ingredients : []), [etat]);

  const rafraichirComposants = useCallback((id: string) => {
    setComposantsEtat({ statut: 'chargement' });
    requeteApi<ListeComposantsVente>(`/produits/${id}/composants`)
      .then((reponse) => {
        setComposantsEtat({ statut: 'pret', composants: reponse.data });
      })
      .catch((erreur: unknown) => {
        setComposantsEtat({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi
              ? erreur.message
              : 'Erreur inattendue, sans plus de détail.',
        });
      });
  }, []);

  useEffect(() => {
    if (produitId === '') {
      setComposantsEtat({ statut: 'inactif' });
      return;
    }
    rafraichirComposants(produitId);
    setSelectionId(null);
    setBrouillon(BROUILLON_VIDE);
    setChampsEnErreur({});
    setErreurFormulaire(null);
    setEnregistrement('inchange');
  }, [produitId, rafraichirComposants]);

  const composants = useMemo(
    () => (composantsEtat.statut === 'pret' ? composantsEtat.composants : []),
    [composantsEtat],
  );

  function choisirComposant(composant: ComposantVente): void {
    setSelectionId(composant.id);
    setBrouillon({
      ingredientId: composant.ingredientId,
      quantiteUniteRef: String(composant.quantiteUniteRef),
      quantiteReferenceUnites: String(composant.quantiteReferenceUnites),
      mode: versMode(composant.consommationSurPlace),
      optionnel: composant.optionnel,
    });
    setChampsEnErreur({});
    setErreurFormulaire(null);
    setEnregistrement('inchange');
  }

  function nouveauComposant(): void {
    setSelectionId(null);
    setBrouillon(BROUILLON_VIDE);
    setChampsEnErreur({});
    setErreurFormulaire(null);
    setEnregistrement('inchange');
    window.setTimeout(() => formulaireRef.current?.querySelector('select')?.focus(), 0);
  }

  function modifier<C extends keyof Brouillon>(champ: C, valeur: Brouillon[C]): void {
    setBrouillon((precedent) => ({ ...precedent, [champ]: valeur }));
    // Validation À LA SAUVEGARDE, jamais en direct — voir
    // `champsEnErreurApresModification` (`../composants/formulaire`) pour la
    // justification complète, partagée avec Ingrédients, Produits, Lieux de
    // marché, Concurrents et Équipements.
    setChampsEnErreur(champsEnErreurApresModification);
  }

  /**
   * Avertissement de saisie : « pour 1 unité, X g » où X < 1 g s'arrondirait à
   * zéro si le lot de référence n'était pas augmenté. C'est un conseil, pas un
   * refus — la fiche 15 recommande d'avertir plutôt que de bloquer.
   */
  const avertissementLotReference = useMemo(() => {
    const quantite = Number.parseInt(brouillon.quantiteUniteRef, 10);
    const reference = Number.parseInt(brouillon.quantiteReferenceUnites, 10);
    if (!Number.isFinite(quantite) || !Number.isFinite(reference) || reference <= 0) return null;
    if (quantite / reference >= 1) return null;
    // Le plus petit lot de référence qui fait atteindre 1 unité entière.
    const referenceMinimale =
      Math.ceil(reference / Math.max(quantite, 1)) * quantite >= reference
        ? Math.ceil(reference / quantite)
        : reference;
    return (
      `Avec ce lot de référence, la quantité consommée par unité vendue est inférieure à 1 : ` +
      `elle s'arrondirait à 0 sur une vente isolée. Ce n'est un problème que si moins de ` +
      `${referenceMinimale} unités sont vendues par session — augmentez le lot de référence si ` +
      `vous voulez que ce composant compte dès de petits volumes.`
    );
  }, [brouillon.quantiteUniteRef, brouillon.quantiteReferenceUnites]);

  function corpsDepuisBrouillon(): Record<string, unknown> | null {
    const erreurs = erreursSaisieComposantVente(brouillon);

    if (Object.keys(erreurs).length > 0) {
      setChampsEnErreur(erreurs);
      // Défaut mesuré (recette clavier du 30/07/2026), même patron que
      // Fournisseurs et Concurrents : `setChampsEnErreur` sans
      // `focaliserPremierChampFautif` juste après laissait le focus sur le
      // bouton « Enregistrer », sans rien qui guide vers le champ fautif.
      focaliserPremierChampFautif(erreurs);
      return null;
    }

    // `erreursSaisieComposantVente` vient de vérifier que ces deux quantités
    // sont des entiers strictement positifs : ne recalcule aucune erreur,
    // redérive seulement les mêmes valeurs (même patron que
    // `corpsSaisieProduit`, `Produits.tsx`).
    return {
      ingredientId: brouillon.ingredientId,
      quantiteUniteRef: Number.parseInt(brouillon.quantiteUniteRef.trim(), 10),
      quantiteReferenceUnites: Number.parseInt(brouillon.quantiteReferenceUnites.trim(), 10),
      consommationSurPlace: versConsommationSurPlace(brouillon.mode),
      optionnel: brouillon.optionnel,
    };
  }

  function focaliserPremierChampFautif(champs: Record<string, string>): void {
    const premier = Object.keys(champs)[0];
    if (premier === undefined) return;
    formulaireRef.current?.querySelector<HTMLElement>(`[name="${premier}"]`)?.focus();
  }

  function enregistrer(): void {
    if (produitId === '') return;
    const corps = corpsDepuisBrouillon();
    if (corps === null) return;

    setErreurFormulaire(null);
    setEnregistrement('enregistrement');

    const chemin =
      selectionId === null ? `/produits/${produitId}/composants` : `/composants/${selectionId}`;
    const methode = selectionId === null ? 'POST' : 'PATCH';

    requeteApi<ComposantVente>(chemin, { method: methode, body: JSON.stringify(corps) })
      .then((enregistre) => {
        rafraichirComposants(produitId);
        setSelectionId(enregistre.id);
        setEnregistrement('enregistre');
        setHeureEnregistrement(heureCourante());
      })
      .catch((erreur: unknown) => {
        setEnregistrement('inchange');
        if (erreur instanceof ErreurApi && erreur.champs !== undefined) {
          setChampsEnErreur(erreur.champs);
          focaliserPremierChampFautif(erreur.champs);
          return;
        }
        setErreurFormulaire(
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
        );
      });
  }

  function basculerActivite(composant: ComposantVente): void {
    requeteApi<ComposantVente>(`/composants/${composant.id}/activite`, {
      method: 'PATCH',
      body: JSON.stringify({ actif: !composant.actif }),
    })
      .then(() => {
        rafraichirComposants(produitId);
      })
      .catch((erreur: unknown) => {
        setErreurFormulaire(
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
        );
      });
  }

  /**
   * Largeurs revues le 31/07/2026 (recette au navigateur,
   * docs/25-RECETTE-APRES-CAMPAGNE.md §5) : mesuré à l'écran, la colonne
   * « Mode » (99,3 px) tronquait « Peu importe · Option » (119,8 px de texte)
   * en « Peu import… » — perdant le qualificatif « · Option », qui n'est PAS
   * décoratif (fiche 15 §4.1bis, il évite de déclarer un café noir « au
   * lait »). `troncature: 'repli'` ajouté sur `mode` pour cette raison
   * précise : cette colonne ne doit plus jamais PERDRE silencieusement un
   * mot par ellipse. 27 % loge le pire cas RÉELLEMENT présent dans les
   * données (« Peu importe · Option », 143,8 px requis) sans repli.
   *
   * `quantite` avait le même défaut, plus discret (jamais signalé par la
   * mission, trouvé en mesurant chaque cellule avant de corriger) : « 20 g
   * pour 100 unités vendues » (167,9 px) débordait déjà de ses 165,5 px
   * alloués (30 %), coupée d'un rien. `repli` ajouté ici aussi — cette seule
   * ligne (Cannelle) replie encore à 25 %, un compromis assumé : lui donner
   * les ~35 % que réclamerait ce cas EXACT aurait affamé `ingredient` et
   * `mode`, qui protègent chacun une perte d'information plus grave (un nom
   * qui distingue deux ingrédients, un qualificatif qui change le sens).
   *
   * `ingredient` (première mouture à 28 %, réduite à 14 % par erreur lors du
   * premier passage de cette correction, puis re-mesurée) : remontée à 20 %
   * — encore trop juste pour « Sucre en poudre »/« Gobelet carton » (~22 %
   * demandés), qui replient sur deux lignes, mais assez pour les noms plus
   * courts. Même compromis que `quantite` : cinq colonnes ne peuvent pas
   * toutes obtenir leur pire cas dans un tableau de ~552 px.
   *
   * L'en-tête « Coût du lot (€) » (114 px requis) et « Statut » (68 px requis
   * en dernière colonne, rembourrage 16 px) débordaient EUX AUSSI de leurs
   * allocations d'origine (77 px, 55 px) — trouvé par la même mesure, jamais
   * cité par la mission. `cout` reprend une abréviation choisie
   * (« Coût (€) », `libelleLong` porte le libellé complet en infobulle,
   * même mécanisme que `Fournisseurs.tsx`/`Concurrents.tsx`) plutôt qu'un
   * agrandissement : le tableau n'a pas la place de tout élargir à la fois.
   */
  const COLONNES: ReadonlyArray<ColonneTableau<ComposantVente>> = [
    {
      cle: 'ingredient',
      libelle: 'Ingrédient',
      largeur: '20%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (c) => c.nomIngredient,
    },
    {
      cle: 'quantite',
      libelle: 'Quantité déclarée',
      largeur: '25%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (c) =>
        c.quantiteReferenceUnites === 1
          ? `${c.quantiteUniteRef} ${c.unite} / unité vendue`
          : `${c.quantiteUniteRef} ${c.unite} pour ${c.quantiteReferenceUnites} unités vendues`,
    },
    {
      cle: 'mode',
      libelle: 'Mode',
      largeur: '27%',
      alignement: 'texte',
      troncature: 'repli',
      // « · Option » distingue un composant servi seulement sur demande (la
      // crème) d'un composant toujours appliqué (le gobelet) — c'est cette
      // distinction que l'affichette d'allergènes exploite pour ne pas
      // déclarer un café noir « au lait » (fiche 15 §4.1bis).
      rendu: (c) =>
        `${libelleMode(versMode(c.consommationSurPlace))}${c.optionnel ? ' · Option' : ''}`,
    },
    {
      cle: 'cout',
      libelle: 'Coût (€)',
      libelleLong: 'Coût du lot (€)',
      largeur: '15%',
      alignement: 'nombre',
      // « Prix inconnu », jamais « 0,00 € » : un composant jamais acheté n'a
      // pas un coût gratuit, il a un coût qui n'est simplement pas encore
      // connu (voir `coutLotReferenceCents` ci-dessus).
      rendu: (c) => {
        const cout = coutLotReferenceCents(c);
        return cout === null ? (
          <span className="text-ink-3">Prix inconnu</span>
        ) : (
          formaterMontant(cout)
        );
      },
    },
    {
      cle: 'statut',
      libelle: 'Statut',
      largeur: '13%',
      alignement: 'texte',
      rendu: (c) =>
        c.actif ? (
          <span className="text-ink-2">Actif</span>
        ) : (
          <span className="text-ink-3">Désactivé</span>
        ),
    },
  ];

  const produitSelectionne = produits.find((p) => p.id === produitId) ?? null;
  const selection = composants.find((c) => c.id === selectionId) ?? null;

  return (
    <div
      className="flex flex-col gap-bloc"
      onKeyDown={(evenement) => {
        // Ctrl+S : même raccourci d'enregistrement que Fournisseurs, Produits
        // et Ingrédients (docs/07 §4.6). Sans effet si aucun composant n'est
        // en cours de saisie : `enregistrer()` sort tôt dans ce cas.
        if ((evenement.ctrlKey || evenement.metaKey) && evenement.key === 's') {
          evenement.preventDefault();
          enregistrer();
        }
      }}
    >
      <div className="flex h-rangee items-center justify-between">
        <h1 className="text-lg text-ink">Nomenclature de vente</h1>
      </div>

      <Panneau titre="Produit" sansRembourrage>
        <div className="flex flex-col gap-groupe px-4 py-3">
          <label className="flex flex-col gap-groupe text-sm text-ink-2">
            Choisir un produit
            <select
              className="h-controle rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
              value={produitId}
              onChange={(evenement) => setProduitId(evenement.target.value)}
            >
              <option value="">— Choisir —</option>
              {produits
                .filter((p) => p.actif)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nom} ({libelleNature(p.nature)})
                  </option>
                ))}
            </select>
          </label>
          {etat.statut === 'erreur' && <MessageErreur message={etat.message} />}
          <p className="text-xs text-ink-3">
            Ce qu'un produit consomme au moment où il est VENDU — serviette, gobelet, café en
            poudre, topping vendu à la pièce — par opposition à la recette, consommée à la
            production. Le café à la tasse n'a pas de lot de production : c'est ici qu'il déclare ce
            qu'il consomme.
          </p>
        </div>
      </Panneau>

      {produitId === '' ? (
        <Panneau titre="Composants">
          <EtatVide
            variante="premier-lancement"
            titre="Choisissez un produit"
            explication="Sélectionnez un produit ci-dessus pour déclarer ce qu'il consomme à la vente."
          />
        </Panneau>
      ) : (
        <div className="grid grid-cols-1 items-start gap-bloc lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
          <Panneau
            titre={
              produitSelectionne === null
                ? 'Composants'
                : `Composants de « ${produitSelectionne.nom} »`
            }
            sansRembourrage
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-2">
              <span className="text-xs text-ink-3">
                {composants.length} composant{composants.length > 1 ? 's' : ''} déclaré
                {composants.length > 1 ? 's' : ''}
              </span>
              <button
                type="button"
                onClick={nouveauComposant}
                className="h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover"
              >
                Nouveau composant
              </button>
            </div>

            {composantsEtat.statut === 'chargement' && (
              <p className="px-4 py-2 text-sm text-ink-3">Chargement des composants…</p>
            )}
            {composantsEtat.statut === 'erreur' && (
              <div className="px-4 py-2">
                <MessageErreur message={composantsEtat.message} />
              </div>
            )}
            {composantsEtat.statut === 'pret' && (
              <Tableau
                colonnes={COLONNES}
                lignes={composants}
                cleLigne={(c) => c.id}
                total={composants.length}
                libelleEntite="composants"
                {...(selectionId !== null ? { ligneSelectionneeCle: selectionId } : {})}
                onSelectionnerLigne={choisirComposant}
                etatVide={
                  <EtatVide
                    variante="premier-lancement"
                    titre="Aucun composant déclaré"
                    explication="Sans composant, aucune serviette, aucun gobelet, aucune pincée de cannelle ne sort du stock à la vente."
                    action={{ libelle: 'Déclarer un composant', onClick: nouveauComposant }}
                  />
                }
              />
            )}
          </Panneau>

          <Panneau titre={selection === null ? 'Nouveau composant' : selection.nomIngredient}>
            <form
              ref={formulaireRef}
              className="flex flex-col gap-bloc"
              onSubmit={(evenement) => {
                evenement.preventDefault();
                enregistrer();
              }}
            >
              <label className="flex flex-col gap-groupe text-sm text-ink-2">
                Ingrédient consommé
                <select
                  name="ingredientId"
                  className={`h-controle rounded-sm border bg-surface px-2 text-sm text-ink ${
                    champsEnErreur['ingredientId'] === undefined
                      ? 'border-line-field'
                      : 'border-depassement'
                  }`}
                  value={brouillon.ingredientId}
                  onChange={(evenement) => modifier('ingredientId', evenement.target.value)}
                >
                  <option value="">Choisir un ingrédient…</option>
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nom} ({i.unite})
                    </option>
                  ))}
                </select>
                {champsEnErreur['ingredientId'] !== undefined && (
                  <span className="text-xs text-depassement">{champsEnErreur['ingredientId']}</span>
                )}
              </label>

              <div className="grid grid-cols-2 gap-groupe">
                <label className="flex flex-col gap-groupe text-sm text-ink-2">
                  Quantité consommée
                  <input
                    name="quantiteUniteRef"
                    type="text"
                    inputMode="numeric"
                    className={`num h-controle rounded-sm border bg-surface px-2 text-base text-ink ${
                      champsEnErreur['quantiteUniteRef'] === undefined
                        ? 'border-line-field'
                        : 'border-depassement'
                    }`}
                    value={brouillon.quantiteUniteRef}
                    onChange={(evenement) => modifier('quantiteUniteRef', evenement.target.value)}
                  />
                  {champsEnErreur['quantiteUniteRef'] !== undefined && (
                    <span className="text-xs text-depassement">
                      {champsEnErreur['quantiteUniteRef']}
                    </span>
                  )}
                </label>
                <label className="flex flex-col gap-groupe text-sm text-ink-2">
                  Pour combien d'unités vendues
                  <input
                    name="quantiteReferenceUnites"
                    type="text"
                    inputMode="numeric"
                    className={`num h-controle rounded-sm border bg-surface px-2 text-base text-ink ${
                      champsEnErreur['quantiteReferenceUnites'] === undefined
                        ? 'border-line-field'
                        : 'border-depassement'
                    }`}
                    value={brouillon.quantiteReferenceUnites}
                    onChange={(evenement) =>
                      modifier('quantiteReferenceUnites', evenement.target.value)
                    }
                  />
                  {champsEnErreur['quantiteReferenceUnites'] !== undefined && (
                    <span className="text-xs text-depassement">
                      {champsEnErreur['quantiteReferenceUnites']}
                    </span>
                  )}
                </label>
              </div>

              <p className="text-xs text-ink-3">
                Une petite quantité (une pincée de cannelle, un trait de sel) s'arrondirait à zéro
                si elle était déclarée pour une seule unité vendue. Déclarez-la « pour 100 unités
                vendues », exactement comme une recette s'écrit « pour 6 crêpes » — la sortie de
                stock se fait sur le TOTAL vendu par session, jamais unité par unité.
              </p>
              {avertissementLotReference !== null && (
                <p role="alert" className="text-xs text-alerte">
                  {avertissementLotReference}
                </p>
              )}

              <fieldset className="flex flex-col gap-groupe">
                <legend className="text-2xs uppercase text-ink-3">Mode de consommation</legend>
                {(['indifferent', 'sur_place', 'emporte'] as const).map((mode) => (
                  <label key={mode} className="flex items-center gap-groupe text-sm text-ink-2">
                    <input
                      type="radio"
                      name="mode"
                      checked={brouillon.mode === mode}
                      onChange={() => modifier('mode', mode)}
                    />
                    {libelleMode(mode)}
                  </label>
                ))}
                <p className="text-xs text-ink-3">
                  Une assiette ne sert que sur place, un contenant que pour l'emporte. « Peu importe
                  » sort ce composant quel que soit le mode de consommation de la vente.
                </p>
              </fieldset>

              <label className="flex items-start gap-groupe text-sm text-ink-2">
                <input
                  type="checkbox"
                  name="optionnel"
                  className="mt-1"
                  checked={brouillon.optionnel}
                  onChange={(evenement) => modifier('optionnel', evenement.target.checked)}
                />
                <span>
                  Option — servie seulement sur demande
                  <span className="block text-xs text-ink-3">
                    À cocher pour un ajout que le client demande (la crème d'un café), jamais pour
                    ce qui accompagne systématiquement la vente (le gobelet). Une option qui porte
                    un allergène (le lait de la crème) est annoncée à part sur l'affichette, sous «
                    sur demande » — la décocher la déclarerait à tort sur tous les cafés vendus,
                    même noirs.
                  </span>
                </span>
              </label>

              {erreurFormulaire !== null && <MessageErreur message={erreurFormulaire} />}

              <div className="flex items-center justify-between border-t border-line pt-3">
                <span className="text-xs text-ink-3">
                  {enregistrement === 'inchange' && TIRET_ABSENT}
                  {enregistrement === 'enregistrement' && 'Enregistrement…'}
                  {enregistrement === 'enregistre' && (
                    <span className="text-conforme">Enregistré {heureEnregistrement}</span>
                  )}
                </span>
                <div className="flex items-center gap-groupe">
                  {selection !== null && (
                    <button
                      type="button"
                      onClick={() => basculerActivite(selection)}
                      className="h-controle rounded-sm border border-line-field bg-surface px-3 text-sm font-medium text-ink-2 hover:bg-surface-sunken"
                    >
                      {selection.actif ? 'Désactiver' : 'Réactiver'}
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={enregistrement === 'enregistrement'}
                    className="h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:bg-ink-4"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>

              {selection !== null && (
                <p className="text-xs text-ink-3">
                  Un composant ne se supprime pas : un lot consommé via lui il y a deux mois doit
                  rester traçable. Désactivé, il n'est plus sorti du stock aux prochaines ventes,
                  mais reste visible ici.
                </p>
              )}
            </form>
          </Panneau>
        </div>
      )}
    </div>
  );
}
