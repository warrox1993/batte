import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  GLYPHE_STATUT,
  TIRET_ABSENT,
  formaterMontant,
  ouTiret,
  schemaListeCompositionMenu,
  schemaListeMenus,
  schemaListeProduits,
  schemaVentilationMenu,
  type CompositionMenu,
  type MenuResume,
  type Produit,
  type VentilationComposantMenuContrat,
  type VentilationMenuContrat,
  type NatureProduitVente,
} from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { champsEnErreurApresModification } from '../composants/formulaire';
import { MessageErreur } from '../composants/EncartErreur';
import { ErreurApi, requeteApi } from '../lib/api';

/**
 * Écran « Menus » (fiche 16 §2) : un produit qui en contient d'autres, avec
 * son propre prix — crêpe à 3,50 € + café à 2,00 € vendus 5,00 € en menu.
 *
 * LE PIÈGE DE CET ÉCRAN, ET C'EST TOUT SON INTÉRÊT. Le menu a son propre prix,
 * mais les 50 centimes de remise doivent être RÉPARTIS entre ses composants —
 * sinon la ventilation transformé/revendu (CLAUDE.md §6) devient fausse, et
 * c'est CETTE ventilation qui alimente les compteurs de seuils légaux
 * (franchise TVA notamment). Le panneau « Ventilation du prix » est donc le
 * cœur de l'écran, pas un à-côté : il prouve, à chaque composant, que la
 * somme des parts vaut exactement le prix du menu.
 *
 * DEUX RÉGLAGES DE PRIX IMPOSÉ, À NE PAS CONFONDRE (mission du 30/07/2026).
 * Le champ « Prix imposé dans ce menu » du formulaire de composition
 * ci-dessous est ENREGISTRÉ avec le composant
 * (`menu_composition.prix_force_cents`, écrit et lu de bout en bout depuis
 * `schemaSaisieCompositionMenu` jusqu'au dépôt,
 * `packages/db/src/depots/menus.ts`) : il survit au rechargement et
 * s'applique par défaut à CHAQUE calcul de ventilation, même en méthode
 * prorata. Le panneau « Ventilation du prix » plus bas propose EN PLUS une
 * SIMULATION ÉPHÉMÈRE, composant par composant, qui ne modifie rien en base
 * et ne sert qu'à essayer un scénario ponctuel — elle ne fait que SURCLASSER,
 * pour la durée du calcul en cours, le réglage enregistré.
 *
 * UN MENU PEUT CONTENIR UN PRODUIT REVENDU : rien dans le formulaire ne
 * distingue transformé et revendu au moment de choisir un composant — c'est
 * exactement ce qui rend la ventilation par nature indispensable dès le
 * premier menu mixte.
 */

type EtatEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; produits: Produit[]; menus: MenuResume[] };

type EtatComposition =
  | { statut: 'inactif' }
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; composants: CompositionMenu[] };

type EtatVentilation =
  | { statut: 'inactif' }
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; ventilation: VentilationMenuContrat };

type MethodeRepartition = 'prorata' | 'designe';

type Brouillon = {
  produitInclusId: string;
  quantite: string;
  /**
   * Prix imposé ENREGISTRÉ avec ce composant, saisi en euros (« 1,50 »).
   * Vide = aucun réglage, ce composant suit le prorata — jamais un prix nul.
   * À NE PAS CONFONDRE avec `prixForces` plus bas, qui porte la SIMULATION
   * éphémère du panneau « Ventilation du prix ».
   */
  prixForceCents: string;
};

const BROUILLON_VIDE: Brouillon = { produitInclusId: '', quantite: '1', prixForceCents: '' };

function heureCourante(): string {
  return new Intl.DateTimeFormat('fr-BE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Brussels',
  }).format(new Date());
}

/**
 * Trois natures, trois libelles EXPLICITES.
 *
 * Un ternaire `transforme ? … : 'Revendu'` etiquetait un menu comme « Revendu »
 * — faux, et invisible a la lecture. Un `switch` exhaustif force le compilateur
 * a signaler la prochaine nature ajoutee, au lieu de la ranger en silence dans
 * la derniere branche.
 *
 * EXPORTÉE le 01/08/2026, apres avoir trouve une TROISIEME instance du meme
 * ternaire dans `NomenclatureVente.tsx`. Le defaut avait deja ete corrige deux
 * fois — ici et dans `Produits.tsx` — mais par RECOPIE du `switch`, si bien
 * que rien ne reliait les copies entre elles et qu'un troisieme site a pu
 * survivre. `NomenclatureVente.tsx` importe donc CETTE fonction plutot que
 * d'en ecrire une quatrieme variante. Le mot compte : la ventilation
 * transforme/revendu alimente les compteurs de seuils legaux (CLAUDE.md §6),
 * et a marge egale la revente genere ~2,6 fois plus de chiffre d'affaires.
 */
export function libelleNature(nature: NatureProduitVente): string {
  switch (nature) {
    case 'transforme':
      return 'Transformé';
    case 'revendu':
      return 'Revendu';
    case 'menu':
      return 'Menu';
  }
}

/**
 * Nomme les composants d'un menu dont le coût de revient est inconnu — la
 * TROISIÈME situation que la doctrine d'affichage impose de savoir dire (voir
 * `avertissementCoutRevientInconnu`, `@batte/core`, écrit pour UN produit
 * simple) : un menu dont UN SEUL composant a un coût inconnu n'a pas un coût
 * de zéro, il a un coût PARTIELLEMENT inconnu.
 *
 * `ventilerMenu` (`@batte/core`) applique une règle TOUT-OU-RIEN : un seul
 * composant au coût inconnu rend `coutTotalCents`, `margeMenuCents`,
 * `margeSepareeCents` et `ecartMargeCents` nuls pour TOUT le menu (voir sa
 * doc). Le tableau de la ventilation affiche déjà un tiret par composant
 * inconnu et par agrégat — mais un tiret nu ne dit pas SI c'est un seul café
 * oublié ou la composition entière qui manque de prix : ce message le nomme.
 *
 * `0` reste une valeur CONNUE (un composant réellement offert dans ce menu,
 * voir `menu_composition.prix_force_cents`) : seule une valeur `null` compte
 * comme inconnue, jamais un montant nul — même distinction que
 * `affichageCoutRevientProduit` (`Produits.tsx`).
 *
 * `null` quand tous les composants ont un coût connu : rien à avertir.
 */
export function avertissementCoutVentilationMenu(
  composants: readonly VentilationComposantMenuContrat[],
): string | null {
  const inconnus = composants.filter((c) => c.coutTotalCents === null);
  if (inconnus.length === 0) return null;

  const noms = inconnus.map((c) => `« ${c.nom} »`).join(', ');

  if (inconnus.length === composants.length) {
    return (
      `Coût de revient inconnu pour tous les composants de ce menu (${noms}) : ` +
      'la marge ne peut pas être estimée.'
    );
  }

  const verbe = inconnus.length > 1 ? 'n’ont' : 'n’a';
  return (
    `Coût de revient partiellement inconnu : ${noms} ${verbe} pas de coût de revient connu — ` +
    'la marge de ce menu ne peut donc pas être calculée, même si les autres composants le sont.'
  );
}

async function chargerMenus(): Promise<[Produit[], MenuResume[]]> {
  const [produits, menus] = await Promise.all([
    requeteApi<unknown>('/produits').then((r) => schemaListeProduits.parse(r).data),
    requeteApi<unknown>('/menus').then((r) => schemaListeMenus.parse(r).data),
  ]);
  return [produits, menus];
}

/**
 * Colonnes du panneau « Composition de … » — hissées au niveau module (et
 * exportées) pour être testables sans monter tout l'écran `Menus` : aucune ne
 * ferme sur un état du composant, `rendu` ne dépend que de la ligne reçue.
 *
 * Panneau à ~550 px pour six colonnes (deux panneaux côte à côte, docs/07
 * §3.3) : les six libellés en entier (623 px cumulés) n'y tiennent pas, même
 * une fois la somme des `largeur` ramenée à 100 (elle en manquait 10, garde
 * D-081 — trouvé par `apps/api/src/tableau-largeurs-colonnes.test.ts`, pas à
 * l'œil). `libelleLong` restitue chaque libellé abrégé en entier, en
 * infobulle d'en-tête (`Tableau.tsx`) ; « Produit » perd « inclus » (le
 * panneau s'intitule déjà « Composition de … », qui le dit déjà) et sa
 * colonne garde `troncature: 'repli'` — c'est la colonne IDENTIFIANTE, jamais
 * l'ellipse (D-081).
 */
export const COLONNES_COMPOSITION: ReadonlyArray<ColonneTableau<CompositionMenu>> = [
  {
    cle: 'produit',
    libelle: 'Produit',
    libelleLong: 'Produit inclus',
    largeur: '18%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (c) => c.nomProduitInclus,
  },
  {
    cle: 'nature',
    libelle: 'Nature',
    // 17 %, pas moins : « Transformé » (la plus longue des trois valeurs de
    // `libelleNature`) mesure 88 px pleine graisse comprise — en dessous,
    // c'est la VALEUR (pas seulement l'en-tête) qui se serait mise à couper.
    largeur: '17%',
    alignement: 'texte',
    rendu: (c) => libelleNature(c.nature),
  },
  {
    cle: 'quantite',
    libelle: 'Qté',
    libelleLong: 'Quantité',
    largeur: '10%',
    alignement: 'nombre',
    rendu: (c) => String(c.quantite),
  },
  {
    cle: 'prixCatalogue',
    libelle: 'Prix catal. (€)',
    libelleLong: 'Prix catalogue (€)',
    largeur: '21%',
    alignement: 'nombre',
    rendu: (c) => formaterMontant(c.prixCatalogueCents),
  },
  {
    cle: 'prixForce',
    libelle: 'Prix imp. (€)',
    libelleLong: 'Prix imposé (€)',
    largeur: '18%',
    alignement: 'nombre',
    // Réglage ENREGISTRÉ (`menu_composition.prix_force_cents`) — jamais la
    // simulation éphémère du panneau « Ventilation du prix » plus bas.
    rendu: (c) => ouTiret(c.prixForceCents, formaterMontant),
  },
  {
    cle: 'statut',
    // « Désactivé » (9 lettres) est la valeur la plus longue de cette
    // colonne, plus longue que son propre en-tête : c'est elle qui borne la
    // largeur minimale, pas « Statut ».
    libelle: 'Statut',
    largeur: '16%',
    alignement: 'texte',
    rendu: (c) =>
      c.actif ? (
        <span className="text-ink-2">Actif</span>
      ) : (
        <span className="text-ink-3">Désactivé</span>
      ),
  },
];

export default function Menus() {
  // Pont depuis l'écran Produits (`?produit=<id>`) : créer un produit de
  // nature `menu` puis devoir le rechercher une seconde fois dans le
  // sélecteur ci-dessous serait exactement l'inconfort que le pont équivalent
  // de `NomenclatureVente.tsx` existe déjà pour éviter.
  const [searchParams] = useSearchParams();
  const produitDemandeAppliqueRef = useRef(false);

  const [etat, setEtat] = useState<EtatEcran>({ statut: 'chargement' });
  const [menuId, setMenuId] = useState<string>('');
  const [compositionEtat, setCompositionEtat] = useState<EtatComposition>({ statut: 'inactif' });
  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [brouillon, setBrouillon] = useState<Brouillon>(BROUILLON_VIDE);
  const [champsEnErreur, setChampsEnErreur] = useState<Record<string, string>>({});
  const [erreurFormulaire, setErreurFormulaire] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState<
    'inchange' | 'enregistrement' | 'enregistre'
  >('inchange');
  const [heureEnregistrement, setHeureEnregistrement] = useState<string | null>(null);

  const [methode, setMethode] = useState<MethodeRepartition>('prorata');
  const [prixForces, setPrixForces] = useState<Record<string, string>>({});
  const [ventilationEtat, setVentilationEtat] = useState<EtatVentilation>({ statut: 'inactif' });

  const formulaireRef = useRef<HTMLFormElement>(null);

  const rafraichirEcran = useCallback(() => {
    setEtat({ statut: 'chargement' });
    chargerMenus()
      .then(([produits, menus]) => setEtat({ statut: 'pret', produits, menus }))
      .catch((erreur: unknown) => {
        setEtat({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi
              ? erreur.message
              : 'Erreur inattendue, sans plus de détail.',
        });
      });
  }, []);

  useEffect(() => {
    rafraichirEcran();
  }, [rafraichirEcran]);

  // Applique `?produit=<id>` UNE SEULE FOIS, dès que la liste est chargée : au
  // delà, c'est l'utilisateur qui choisit, jamais l'URL qui reprend la main
  // sur une sélection déjà faite à la main — même patron que
  // `NomenclatureVente.tsx`.
  useEffect(() => {
    if (produitDemandeAppliqueRef.current || etat.statut !== 'pret') return;
    const produitDemande = searchParams.get('produit');
    if (produitDemande === null) return;
    produitDemandeAppliqueRef.current = true;
    if (etat.produits.some((p) => p.id === produitDemande)) {
      setMenuId(produitDemande);
    }
  }, [etat, searchParams]);

  const produits = useMemo(() => (etat.statut === 'pret' ? etat.produits : []), [etat]);
  const menus = useMemo(() => (etat.statut === 'pret' ? etat.menus : []), [etat]);

  const rafraichirComposition = useCallback((id: string) => {
    setCompositionEtat({ statut: 'chargement' });
    requeteApi<unknown>(`/menus/${id}/composition`)
      .then((reponse) => {
        const composants = schemaListeCompositionMenu.parse(reponse).data;
        setCompositionEtat({ statut: 'pret', composants });
      })
      .catch((erreur: unknown) => {
        setCompositionEtat({
          statut: 'erreur',
          message:
            erreur instanceof ErreurApi
              ? erreur.message
              : 'Erreur inattendue, sans plus de détail.',
        });
      });
  }, []);

  const rafraichirVentilation = useCallback(
    (id: string, methodeCourante: MethodeRepartition, forces: Record<string, string>) => {
      setVentilationEtat({ statut: 'chargement' });

      const prixForcesCents: Record<string, number> = {};
      if (methodeCourante === 'designe') {
        for (const [produitInclusId, saisie] of Object.entries(forces)) {
          const nettoye = saisie.trim().replace(',', '.');
          if (nettoye === '') continue;
          const valeur = Number(nettoye);
          if (Number.isFinite(valeur) && valeur >= 0) {
            prixForcesCents[produitInclusId] = Math.round(valeur * 100);
          }
        }
      }

      requeteApi<unknown>(`/menus/${id}/ventilation`, {
        method: 'POST',
        body: JSON.stringify({ prixForcesCents }),
      })
        .then((reponse) => {
          const ventilation = schemaVentilationMenu.parse(reponse);
          setVentilationEtat({ statut: 'pret', ventilation });
        })
        .catch((erreur: unknown) => {
          setVentilationEtat({
            statut: 'erreur',
            message:
              erreur instanceof ErreurApi
                ? erreur.message
                : 'Erreur inattendue, sans plus de détail.',
          });
        });
    },
    [],
  );

  useEffect(() => {
    if (menuId === '') {
      setCompositionEtat({ statut: 'inactif' });
      setVentilationEtat({ statut: 'inactif' });
      return;
    }
    rafraichirComposition(menuId);
    rafraichirVentilation(menuId, methode, prixForces);
    setSelectionId(null);
    setBrouillon(BROUILLON_VIDE);
    setChampsEnErreur({});
    setErreurFormulaire(null);
    setEnregistrement('inchange');
    // Changer de menu réinitialise la SIMULATION éphémère de cette section —
    // elle n'a jamais vocation à être mémorisée d'un menu à l'autre. Le
    // réglage ENREGISTRÉ, lui, revient avec chaque composant via
    // `rafraichirComposition` ci-dessus : rien à réinitialiser pour lui.
    setMethode('prorata');
    setPrixForces({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuId, rafraichirComposition]);

  const composants = useMemo(
    () => (compositionEtat.statut === 'pret' ? compositionEtat.composants : []),
    [compositionEtat],
  );

  function choisirComposant(composant: CompositionMenu): void {
    setSelectionId(composant.id);
    setBrouillon({
      produitInclusId: composant.produitInclusId,
      quantite: String(composant.quantite),
      prixForceCents:
        composant.prixForceCents === null ? '' : formaterMontant(composant.prixForceCents),
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
    // marché et Concurrents. Défaut mesuré (recette clavier du 30/07/2026) :
    // cette fonction effaçait l'erreur du champ modifié dès la première
    // frappe, sans revalider la nouvelle valeur.
    setChampsEnErreur(champsEnErreurApresModification);
  }

  function corpsDepuisBrouillon(): Record<string, unknown> | null {
    const erreurs: Record<string, string> = {};

    if (brouillon.produitInclusId === '') {
      erreurs['produitInclusId'] = 'Choisissez le produit inclus dans ce menu.';
    }

    let quantite: number | null = null;
    if (!/^\d+$/.test(brouillon.quantite.trim())) {
      erreurs['quantite'] = 'Indiquez un nombre entier strictement positif.';
    } else {
      quantite = Number.parseInt(brouillon.quantite, 10);
      if (quantite <= 0) erreurs['quantite'] = 'La quantité doit être positive.';
    }

    // Prix imposé ENREGISTRÉ (fiche 16 §2.2) : vide = aucun réglage, ce
    // composant suit le prorata — jamais `0`, qui affirmerait « ce composant
    // est offert dans ce menu ».
    let prixForceCents: number | null = null;
    const saisiePrixForce = brouillon.prixForceCents.trim();
    if (saisiePrixForce !== '') {
      const normalise = saisiePrixForce.replace(',', '.');
      const valeur = Number(normalise);
      if (!Number.isFinite(valeur) || valeur < 0) {
        erreurs['prixForceCents'] =
          'Indiquez un montant en euros, positif ou nul (ou laissez vide pour le prorata).';
      } else {
        prixForceCents = Math.round(valeur * 100);
      }
    }

    if (Object.keys(erreurs).length > 0) {
      setChampsEnErreur(erreurs);
      // Même mécanisme qu'Ingrédients, Produits et Lieux de marché : jamais
      // `setChampsEnErreur` sans `focaliserPremierChampFautif` juste après.
      // Défaut mesuré le 01/08/2026 : cet appel manquait pour la validation
      // LOCALE — il n'existait que dans le `.catch` d'une erreur SERVEUR, si
      // bien qu'après un `Ctrl+S` sans produit inclus choisi le focus restait
      // sur le bouton « Enregistrer ». Le porteur devait remonter à la souris
      // jusqu'au champ fautif, exactement le geste que CLAUDE.md §3 règle 10
      // existe pour supprimer.
      focaliserPremierChampFautif(erreurs);
      return null;
    }

    return { produitInclusId: brouillon.produitInclusId, quantite, prixForceCents };
  }

  function focaliserPremierChampFautif(champs: Record<string, string>): void {
    const premier = Object.keys(champs)[0];
    if (premier === undefined) return;
    formulaireRef.current?.querySelector<HTMLElement>(`[name="${premier}"]`)?.focus();
  }

  function enregistrer(): void {
    if (menuId === '') return;
    const corps = corpsDepuisBrouillon();
    if (corps === null) return;

    setErreurFormulaire(null);
    setEnregistrement('enregistrement');

    const chemin =
      selectionId === null ? `/menus/${menuId}/composition` : `/composition-menu/${selectionId}`;
    const methodeHttp = selectionId === null ? 'POST' : 'PATCH';

    requeteApi<CompositionMenu>(chemin, { method: methodeHttp, body: JSON.stringify(corps) })
      .then((enregistre) => {
        rafraichirComposition(menuId);
        rafraichirEcran();
        rafraichirVentilation(menuId, methode, prixForces);
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

  function basculerActivite(composant: CompositionMenu): void {
    requeteApi<CompositionMenu>(`/composition-menu/${composant.id}/activite`, {
      method: 'PATCH',
      body: JSON.stringify({ actif: !composant.actif }),
    })
      .then(() => {
        rafraichirComposition(menuId);
        rafraichirEcran();
        rafraichirVentilation(menuId, methode, prixForces);
      })
      .catch((erreur: unknown) => {
        setErreurFormulaire(
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
        );
      });
  }

  function changerMethode(nouvelle: MethodeRepartition): void {
    setMethode(nouvelle);
    if (nouvelle === 'prorata') {
      rafraichirVentilation(menuId, 'prorata', {});
    }
  }

  function calculerVentilation(): void {
    if (menuId === '') return;
    rafraichirVentilation(menuId, methode, prixForces);
  }

  const COLONNES_MENUS: ReadonlyArray<ColonneTableau<MenuResume>> = [
    {
      cle: 'nom',
      libelle: 'Menu',
      largeur: '46%',
      alignement: 'texte',
      troncature: 'repli',
      rendu: (m) => m.nom,
    },
    {
      cle: 'prix',
      libelle: 'Prix du menu (€)',
      largeur: '22%',
      alignement: 'nombre',
      rendu: (m) => formaterMontant(m.prixCents),
    },
    {
      cle: 'composants',
      libelle: 'Composants actifs',
      largeur: '22%',
      alignement: 'nombre',
      rendu: (m) => String(m.nbComposantsActifs),
    },
    {
      cle: 'statut',
      libelle: 'Statut',
      largeur: '10%',
      alignement: 'texte',
      rendu: (m) =>
        m.actif ? (
          <span className="text-ink-2">Actif</span>
        ) : (
          <span className="text-ink-3">Désactivé</span>
        ),
    },
  ];

  const menuSelectionne = produits.find((p) => p.id === menuId) ?? null;
  const selection = composants.find((c) => c.id === selectionId) ?? null;
  const ventilation = ventilationEtat.statut === 'pret' ? ventilationEtat.ventilation : null;
  // Voir la doc de `avertissementCoutVentilationMenu` : sans ce message, les
  // tirets de `coutTotalCents`, `margeMenuCents`, etc. (tout-ou-rien dès
  // qu'UN SEUL composant a un coût inconnu) ne disent pas LEQUEL des
  // composants manque de prix.
  const avertissementCoutMenu =
    ventilation === null ? null : avertissementCoutVentilationMenu(ventilation.composants);

  return (
    <div
      className="flex flex-col gap-bloc"
      onKeyDown={(evenement) => {
        if ((evenement.ctrlKey || evenement.metaKey) && evenement.key === 's') {
          evenement.preventDefault();
          enregistrer();
        }
      }}
    >
      <div className="flex h-rangee items-center justify-between">
        <h1 className="text-lg text-ink">Menus</h1>
      </div>

      <Panneau titre="Menus déjà déclarés" sansRembourrage>
        {etat.statut === 'erreur' && (
          <div className="px-4 py-2">
            <MessageErreur message={etat.message} />
          </div>
        )}
        <Tableau
          colonnes={COLONNES_MENUS}
          lignes={menus}
          cleLigne={(m) => m.id}
          total={menus.length}
          libelleEntite="menus"
          {...(menuId !== '' ? { ligneSelectionneeCle: menuId } : {})}
          onSelectionnerLigne={(m) => setMenuId(m.id)}
          etatVide={
            <EtatVide
              variante="normal"
              texte="Aucun menu déclaré : choisissez un produit ci-dessous pour lui ajouter des composants."
            />
          }
        />
      </Panneau>

      <Panneau titre="Choisir un produit" sansRembourrage>
        <div className="flex flex-col gap-groupe px-4 py-3">
          <label className="flex flex-col gap-groupe text-sm text-ink-2">
            Produit à gérer comme menu
            <select
              className="h-controle rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
              value={menuId}
              onChange={(evenement) => setMenuId(evenement.target.value)}
            >
              <option value="">— Choisir —</option>
              {produits
                .filter((p) => p.actif)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nom} ({libelleNature(p.nature)}, {formaterMontant(p.prixCents)} €)
                  </option>
                ))}
            </select>
          </label>
          <p className="text-xs text-ink-3">
            N'importe quel produit peut devenir un menu : il suffit de lui déclarer des composants
            ci-dessous. Son prix reste le sien — c'est le prix DU MENU, pas la somme de ses
            composants.
          </p>
        </div>
      </Panneau>

      {menuId === '' ? (
        <Panneau titre="Composition">
          <EtatVide
            variante="premier-lancement"
            titre="Choisissez un produit"
            explication="Sélectionnez un produit ci-dessus pour déclarer les composants de ce menu."
          />
        </Panneau>
      ) : (
        <>
          <div className="grid grid-cols-1 items-start gap-bloc lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
            <Panneau
              titre={
                menuSelectionne === null
                  ? 'Composition'
                  : `Composition de « ${menuSelectionne.nom} »`
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

              {compositionEtat.statut === 'chargement' && (
                <p className="px-4 py-2 text-sm text-ink-3">Chargement de la composition…</p>
              )}
              {compositionEtat.statut === 'erreur' && (
                <div className="px-4 py-2">
                  <MessageErreur message={compositionEtat.message} />
                </div>
              )}
              {compositionEtat.statut === 'pret' && (
                <Tableau
                  colonnes={COLONNES_COMPOSITION}
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
                      explication="Un menu sans composant ne peut ni sortir de stock, ni être ventilé : déclarez au moins un produit inclus."
                      action={{ libelle: 'Déclarer un composant', onClick: nouveauComposant }}
                    />
                  }
                />
              )}
            </Panneau>

            <Panneau titre={selection === null ? 'Nouveau composant' : selection.nomProduitInclus}>
              <form
                ref={formulaireRef}
                className="flex flex-col gap-bloc"
                onSubmit={(evenement) => {
                  evenement.preventDefault();
                  enregistrer();
                }}
              >
                <label className="flex flex-col gap-groupe text-sm text-ink-2">
                  Produit inclus
                  <select
                    name="produitInclusId"
                    className={`h-controle rounded-sm border bg-surface px-2 text-sm text-ink ${
                      champsEnErreur['produitInclusId'] === undefined
                        ? 'border-line-field'
                        : 'border-depassement'
                    }`}
                    value={brouillon.produitInclusId}
                    onChange={(evenement) => modifier('produitInclusId', evenement.target.value)}
                  >
                    <option value="">Choisir un produit…</option>
                    {produits
                      .filter((p) => p.actif && p.id !== menuId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nom} ({libelleNature(p.nature)}, {formaterMontant(p.prixCents)} €)
                        </option>
                      ))}
                  </select>
                  {champsEnErreur['produitInclusId'] !== undefined && (
                    <span className="text-xs text-depassement">
                      {champsEnErreur['produitInclusId']}
                    </span>
                  )}
                </label>

                <label className="flex flex-col gap-groupe text-sm text-ink-2">
                  Quantité dans le menu
                  <input
                    name="quantite"
                    type="text"
                    inputMode="numeric"
                    className={`num h-controle rounded-sm border bg-surface px-2 text-base text-ink ${
                      champsEnErreur['quantite'] === undefined
                        ? 'border-line-field'
                        : 'border-depassement'
                    }`}
                    value={brouillon.quantite}
                    onChange={(evenement) => modifier('quantite', evenement.target.value)}
                  />
                  {champsEnErreur['quantite'] !== undefined && (
                    <span className="text-xs text-depassement">{champsEnErreur['quantite']}</span>
                  )}
                </label>

                <label className="flex flex-col gap-groupe text-sm text-ink-2">
                  Prix imposé dans ce menu (€) — enregistré
                  <input
                    name="prixForceCents"
                    type="text"
                    inputMode="decimal"
                    placeholder="Laisser vide = prorata"
                    className={`num h-controle rounded-sm border bg-surface px-2 text-base text-ink ${
                      champsEnErreur['prixForceCents'] === undefined
                        ? 'border-line-field'
                        : 'border-depassement'
                    }`}
                    value={brouillon.prixForceCents}
                    onChange={(evenement) => modifier('prixForceCents', evenement.target.value)}
                  />
                  {champsEnErreur['prixForceCents'] !== undefined && (
                    <span className="text-xs text-depassement">
                      {champsEnErreur['prixForceCents']}
                    </span>
                  )}
                </label>
                <p className="text-xs text-ink-3">
                  Ce réglage est ENREGISTRÉ avec ce composant — à la différence de la simulation du
                  panneau « Ventilation du prix » ci-dessous, qui n'est jamais sauvée et disparaît
                  au rechargement. Vide : ce composant suit le prorata des prix catalogue, jamais un
                  prix nul.
                </p>

                <p className="text-xs text-ink-3">
                  Un menu peut inclure un produit transformé ou revendu : le café d'un menu « crêpe
                  + café », comme un pot de sirop d'un menu « crêpe + sirop ».
                </p>

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
                    Un composant ne se supprime pas : désactivé, il n'est plus sorti du stock ni
                    ventilé aux prochaines ventes, mais reste visible ici.
                  </p>
                )}
              </form>
            </Panneau>
          </div>

          <Panneau titre="Ventilation du prix — transformé / revendu" sansRembourrage>
            <div className="flex flex-col gap-bloc px-4 py-3">
              <fieldset className="flex flex-col gap-groupe">
                <legend className="text-2xs uppercase text-ink-3">
                  Méthode de répartition — simulation, non enregistrée
                </legend>
                <label className="flex items-center gap-groupe text-sm text-ink-2">
                  <input
                    type="radio"
                    name="methode"
                    checked={methode === 'prorata'}
                    onChange={() => changerMethode('prorata')}
                  />
                  Au prorata des prix catalogue (sans essai ponctuel supplémentaire)
                </label>
                <label className="flex items-center gap-groupe text-sm text-ink-2">
                  <input
                    type="radio"
                    name="methode"
                    checked={methode === 'designe'}
                    onChange={() => changerMethode('designe')}
                  />
                  Essayer un autre prix, composant par composant (non enregistré)
                </label>
                <p className="text-xs text-ink-3">
                  SIMULATION UNIQUEMENT : ce que vous saisissez ici n'est jamais enregistré et
                  disparaît au rechargement de l'écran. Pour ENREGISTRER durablement un prix imposé
                  par composant, utilisez le champ « Prix imposé dans ce menu » du formulaire de
                  composition ci-dessus — un réglage enregistré s'applique toujours, même en méthode
                  prorata, tant qu'aucun essai ponctuel ne le surclasse ici.
                </p>
              </fieldset>

              {methode === 'designe' && composants.length > 0 && (
                <div className="flex flex-col gap-groupe border-t border-line pt-3">
                  <p className="text-xs text-ink-3">
                    Laissez un champ vide pour que ce composant continue à suivre le prorata sur le
                    reste du prix.
                  </p>
                  {composants
                    .filter((c) => c.actif)
                    .map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center justify-between gap-groupe text-sm text-ink-2"
                      >
                        <span>
                          {c.nomProduitInclus}
                          {c.prixForceCents !== null && (
                            <span className="ml-groupe text-xs text-ink-3">
                              (enregistré : {formaterMontant(c.prixForceCents)} €)
                            </span>
                          )}
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder={formaterMontant(c.prixCatalogueCents)}
                          className="num h-controle w-28 rounded-sm border border-line-field bg-surface px-2 text-right text-sm text-ink"
                          value={prixForces[c.produitInclusId] ?? ''}
                          onChange={(evenement) =>
                            setPrixForces((precedent) => ({
                              ...precedent,
                              [c.produitInclusId]: evenement.target.value,
                            }))
                          }
                        />
                      </label>
                    ))}
                  <div>
                    <button
                      type="button"
                      onClick={calculerVentilation}
                      className="h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover"
                    >
                      Recalculer
                    </button>
                  </div>
                </div>
              )}

              {ventilationEtat.statut === 'chargement' && (
                <p className="text-sm text-ink-3">Calcul de la ventilation…</p>
              )}
              {ventilationEtat.statut === 'erreur' && (
                <MessageErreur message={ventilationEtat.message} />
              )}

              {ventilation !== null && (
                <div className="flex flex-col gap-groupe border-t border-line pt-3">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-2xs uppercase text-ink-3">
                        <th className="py-1">Composant</th>
                        <th className="py-1">Nature</th>
                        <th className="py-1 text-right">Part du prix (€)</th>
                        <th className="py-1 text-right">Coût de revient (€)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ventilation.composants.map((c) => (
                        <tr key={c.produitInclusId} className="border-b border-line">
                          <td className="py-1 text-ink">{c.nom}</td>
                          <td className="py-1 text-ink-2">{libelleNature(c.nature)}</td>
                          <td className="num py-1 text-right text-ink">
                            {formaterMontant(c.partPrixCents)}
                          </td>
                          <td className="num py-1 text-right text-ink-2">
                            {ouTiret(c.coutTotalCents, formaterMontant)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {avertissementCoutMenu !== null && (
                    <p role="alert" className="text-xs text-alerte">
                      <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span> {avertissementCoutMenu}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-groupe pt-2 sm:grid-cols-4">
                    <div>
                      <p className="text-2xs uppercase text-ink-3">CA transformé</p>
                      <p className="num text-sm text-ink">
                        {formaterMontant(ventilation.parNatureCents.transforme)} €
                      </p>
                    </div>
                    <div>
                      <p className="text-2xs uppercase text-ink-3">CA revendu</p>
                      <p className="num text-sm text-ink">
                        {formaterMontant(ventilation.parNatureCents.revendu)} €
                      </p>
                    </div>
                    <div>
                      <p className="text-2xs uppercase text-ink-3">Prix du menu</p>
                      <p className="num text-sm text-ink">
                        {formaterMontant(ventilation.prixMenuCents)} €
                      </p>
                    </div>
                    <div>
                      <p className="text-2xs uppercase text-ink-3">Coût total</p>
                      <p className="num text-sm text-ink">
                        {ouTiret(ventilation.coutTotalCents, formaterMontant)}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-groupe border-t border-line pt-3 sm:grid-cols-3">
                    <div>
                      <p className="text-2xs uppercase text-ink-3">Marge du menu</p>
                      <p className="num text-sm text-ink">
                        {ouTiret(ventilation.margeMenuCents, formaterMontant)}
                      </p>
                    </div>
                    <div>
                      <p className="text-2xs uppercase text-ink-3">Marge si vendus séparément</p>
                      <p className="num text-sm text-ink">
                        {ouTiret(ventilation.margeSepareeCents, formaterMontant)} (prix séparé{' '}
                        {formaterMontant(ventilation.prixSepareTotalCents)} €)
                      </p>
                    </div>
                    <div>
                      <p className="text-2xs uppercase text-ink-3">Écart menu vs séparé</p>
                      <p className="num text-sm text-ink">
                        {ouTiret(ventilation.ecartMargeCents, formaterMontant)}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-ink-3">
                    Un écart négatif est attendu : le menu attire du volume en échange d'un peu de
                    marge. C'est ce chiffre qui dit COMBIEN, pour décider si le menu vaut la peine.
                  </p>
                </div>
              )}
            </div>
          </Panneau>
        </>
      )}
    </div>
  );
}
