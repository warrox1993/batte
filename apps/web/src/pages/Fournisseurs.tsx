import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GLYPHE_STATUT,
  formaterMontant,
  parserEuros,
  schemaFournisseur,
  schemaListeFournisseurs,
  type Fournisseur,
  type TypeFournisseur,
} from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { champsEnErreurApresModification } from '../composants/formulaire';
import { MessageErreur } from '../composants/EncartErreur';
import {
  ChampTexte,
  IndicateurEnregistrement,
  type EtatEnregistrement,
} from '../composants/champs-formulaire';
import { ErreurApi, requeteApi } from '../lib/api';

/**
 * Ecran Fournisseurs (docs/06 — groupe RÉFÉRENTIEL).
 *
 * Panneau gauche : la liste, triee par nom, avec une colonne d'EXCEPTION.
 * Panneau droit : la fiche du fournisseur choisi, ou un formulaire de creation.
 *
 * DEUX PARTIS PRIS QUI MERITENT D'ETRE LUS.
 *
 * 1. **On ne supprime pas, on desactive.** Aucun bouton « Supprimer » n'existe
 *    sur cet ecran, et il ne doit jamais en apparaitre : un fournisseur est
 *    reference par des lots recus il y a deux ans, dont la tracabilite AFSCA
 *    doit rester lisible (CLAUDE.md §3 regle 7). Un fournisseur qu'on ne
 *    frequente plus se desactive : il disparait des listes de choix, il reste
 *    dans l'historique.
 *
 * 2. **La colonne « Statut » est une colonne d'exception, pas de decoration.**
 *    Un fournisseur actif SANS adresse e-mail fait echouer l'envoi du bon de
 *    commande (`POST /api/commandes/:id/envoyer` rend alors un 422
 *    « email_manquant »). Sans ce signal, l'utilisateur ne le decouvre que le
 *    jour ou il essaie de commander — c'est-a-dire trop tard. C'est une *cue*
 *    au sens de docs/07 §2.2 : une anomalie visible la ou on peut la corriger.
 *
 * Regle d'architecture n°1 : aucun calcul metier ici. Les montants passent par
 * `parserEuros` / `formaterMontant` de `@batte/core`, la validation par le
 * schema Zod partage, et la reponse du serveur fait foi.
 */

type EtatListe =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; fournisseurs: Fournisseur[] };

/** Champs du formulaire, tous en chaines : c'est ce que rend un `<input>`. */
export type Brouillon = {
  nom: string;
  type: TypeFournisseur;
  email: string;
  telephone: string;
  adresse: string;
  delaiLivraisonJours: string;
  francoDePort: string;
  commandeMinimum: string;
  notes: string;
};

const BROUILLON_VIDE: Brouillon = {
  nom: '',
  type: 'grossiste',
  email: '',
  telephone: '',
  adresse: '',
  delaiLivraisonJours: '0',
  francoDePort: '',
  commandeMinimum: '',
  notes: '',
};

const TYPES: ReadonlyArray<{ valeur: TypeFournisseur; libelle: string }> = [
  { valeur: 'moulin', libelle: 'Moulin' },
  { valeur: 'grossiste', libelle: 'Grossiste' },
  { valeur: 'ferme', libelle: 'Ferme' },
  { valeur: 'detail', libelle: 'Détail' },
];

/**
 * `systeme` n'est volontairement PAS dans `TYPES` (non saisissable depuis le
 * formulaire, `packages/db/src/schema.ts:118-123`) : sans ce cas particulier,
 * `libelleType` retombait sur la valeur brute de l'enum et affichait
 * `systeme` en minuscule, sans accent, alors que toutes les autres lignes
 * affichent un libellé capitalisé (« Grossiste », « Ferme »). Mesuré à
 * l'écran le 31/07/2026 sur « Inventaire d'ouverture ». Pas une nouvelle
 * option de formulaire — juste l'affichage cohérent d'une valeur qui existe
 * déjà et qui reste, elle, toujours en lecture seule.
 */
export function libelleType(type: TypeFournisseur): string {
  if (type === 'systeme') return 'Système';
  return TYPES.find((t) => t.valeur === type)?.libelle ?? type;
}

function versBrouillon(fournisseur: Fournisseur): Brouillon {
  return {
    nom: fournisseur.nom,
    type: fournisseur.type,
    email: fournisseur.email ?? '',
    telephone: fournisseur.telephone ?? '',
    adresse: fournisseur.adresse ?? '',
    delaiLivraisonJours: String(fournisseur.delaiLivraisonJours),
    francoDePort:
      fournisseur.francoDePortCents === null ? '' : formaterMontant(fournisseur.francoDePortCents),
    commandeMinimum:
      fournisseur.commandeMinimumCents === null
        ? ''
        : formaterMontant(fournisseur.commandeMinimumCents),
    notes: fournisseur.notes ?? '',
  };
}

/**
 * Validation LOCALE du brouillon, avant tout aller-retour — même patron que
 * `erreursSaisieProduit` (`Produits.tsx`) et `erreursSaisieConcurrent`
 * (`Concurrents.tsx`).
 *
 * Extraite en fonction PURE et exportée pour prouver, sans monter tout
 * l'écran, quel champ un délai illisible ou un montant illisible
 * désigne EN PREMIER — c'est ce nom de champ que
 * `focaliserPremierChampFautif` doit atteindre juste après
 * `setChampsEnErreur` (défaut mesuré le 30/07/2026 : cet appel manquait ici,
 * le focus restait sur le bouton « Enregistrer »).
 *
 * Ne signale JAMAIS de zéro devine : un montant facultatif vide n'est pas une
 * erreur (il part à `null`, voir `corpsDepuisBrouillon`), seul un montant
 * SAISI mais illisible en est une.
 */
export function erreursSaisieFournisseur(brouillon: Brouillon): Record<string, string> {
  const erreurs: Record<string, string> = {};

  if (!/^\d+$/.test(brouillon.delaiLivraisonJours.trim())) {
    erreurs['delaiLivraisonJours'] =
      'Indiquez un nombre entier de jours (0 si livraison immédiate).';
  }

  function montantFacultatifIllisible(saisie: string): boolean {
    return saisie.trim() !== '' && parserEuros(saisie) === null;
  }

  if (montantFacultatifIllisible(brouillon.francoDePort)) {
    erreurs['francoDePortCents'] = 'Montant illisible. Exemple attendu : 150,00';
  }
  if (montantFacultatifIllisible(brouillon.commandeMinimum)) {
    erreurs['commandeMinimumCents'] = 'Montant illisible. Exemple attendu : 150,00';
  }

  return erreurs;
}

/** Heure locale belge, pour l'indicateur « Enregistré 21:04 ». */
function heureCourante(): string {
  return new Intl.DateTimeFormat('fr-BE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Brussels',
  }).format(new Date());
}

/**
 * Statut affiche dans la liste. Quatre cas — le premier n'est PAS un degre de
 * gravite, les trois suivants le sont, toujours doubles d'un mot : la couleur
 * seule ne porte jamais un signal (daltonisme, et ces tableaux partent en PDF
 * noir et blanc).
 *
 * `type === 'systeme'` est verifie EN PREMIER, avant meme `actif` : c'est une
 * proprieté structurelle de la ligne (le seul cas aujourd'hui est « Inventaire
 * d'ouverture »), pas un etat transitoire comme les trois autres.
 *
 * SANS CE CAS PARTICULIER, `▲ Sans e-mail` s'affichait pour ce fournisseur —
 * et s'affichera TOUJOURS, puisque cette contrepartie interne ne recevra
 * jamais de vraie commande (`packages/db/src/seed/fournisseurs-systeme.ts`,
 * `conditionnementReference` dans `packages/db/src/services/commandes.ts`,
 * qui l'ecarte deja du moteur de reapprovisionnement). Un avertissement qui
 * ne peut structurellement
 * jamais se resoudre est exactement ce que docs/07 §3.5 interdit
 * (« aucune alerte non actionnable ») — mesure a l'ecran le 31/07/2026.
 *
 * Le libelle choisi n'est PAS un glyphe d'alerte : c'est un texte neutre
 * (meme encre que `Inactif`, `text-ink-3`) qui dit ce qui est vrai — cette
 * ligne ne recoit jamais de bon de commande — plutot qu'un vide qui se
 * lirait comme une case oubliee (docs/07 §4.5, « zero et inconnu ne
 * s'ecrivent pas pareil »).
 */
export function statutFournisseur(f: Fournisseur): { texte: string; classe: string } {
  if (f.type === 'systeme') return { texte: 'Non commercial', classe: 'text-ink-3' };
  if (!f.actif) return { texte: 'Inactif', classe: 'text-ink-3' };
  if (f.email === null) {
    return {
      texte: `${GLYPHE_STATUT.alerte} Sans e-mail`,
      classe: 'text-alerte',
    };
  }
  return { texte: `${GLYPHE_STATUT.conforme} Par mail`, classe: 'text-conforme' };
}

/**
 * `fournisseursProposables` — DÉPLACÉ vers `packages/core/src/fournisseurs.ts`
 * (mission « garde-fou fournisseur système : de l'écran au service, puis son
 * vrai foyer », 31/07/2026) : c'est une règle de DOMAINE, pas une règle
 * d'écran (CLAUDE.md §3 règle 1), et `Factures.tsx`/`Ingredients.tsx`/
 * `Economies.tsx` l'importaient d'ici — un écran important un autre écran
 * pour trois mots de filtre, ce qui aurait tiré tout cet écran référentiel
 * derrière eux si `Fournisseurs.tsx` devenait un jour chargé paresseusement.
 * Voir `packages/core/src/fournisseurs.ts` pour la fonction et son
 * historique complet, et `packages/core/src/fournisseurs.test.ts` pour ses
 * tests (déplacés depuis `Fournisseurs.test.tsx`).
 */

/**
 * QUATRE colonnes, pas cinq.
 *
 * A la resolution cible (viewport effectif 1280x720, docs/07 §4.4), la barre de
 * navigation prend 224 px et le panneau de liste retombe a ~460 px. Une
 * cinquieme colonne y tronquait les EN-TETES eux-memes (« BON DE … »,
 * « AR… ») : un en-tete tronque ne se devine pas, contrairement a une valeur
 * qu'on peut survoler. Le compte de conditionnements est donc passe dans la
 * fiche de droite, ou il a la place d'etre lisible.
 */
const COLONNES: ReadonlyArray<ColonneTableau<Fournisseur>> = [
  {
    /**
     * `repli` et non ellipse : c'est la colonne d'IDENTIFICATION, elle ne doit
     * jamais être coupée. Deux fournisseurs peuvent partager un début de nom
     * (« Ferme de … », « Moulin de … ») et ne se distinguer qu'à la fin —
     * précisément ce que l'ellipse mange en premier. Sélectionner le mauvais
     * fournisseur, c'est modifier le mauvais délai de livraison, donc fausser
     * un point de commande.
     *
     * Pas de `titre` : la valeur entière est rendue, une infobulle qui
     * répéterait le texte visible serait du bruit.
     */
    cle: 'nom',
    libelle: 'Nom',
    largeur: '32%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (f) => f.nom,
  },
  {
    // Contenu BORNÉ (quatre valeurs) : cette colonne peut céder de la largeur
    // au nom, dont la longueur est imprévisible. Mesuré à 1280 px : 18 %
    // coupait encore « Grossiste » en « Grossi… » malgré le `titre` — la
    // largeur qui « frôlait » ne suffisait pas. Le `titre` reste, en filet de
    // sécurité.
    cle: 'type',
    libelle: 'Type',
    largeur: '23%',
    alignement: 'texte',
    rendu: (f) => libelleType(f.type),
    titre: (f) => libelleType(f.type),
  },
  {
    // 18 % : l'en-tete « DÉLAI (J) » mesure ~86 px en 11 px majuscules
    // interlettrees, rembourrage compris. En dessous, c'est l'EN-TETE qui se
    // tronque — et un en-tete tronque ne se devine pas.
    cle: 'delai',
    libelle: 'Délai (j)',
    largeur: '18%',
    alignement: 'nombre',
    rendu: (f) => f.delaiLivraisonJours,
  },
  {
    cle: 'statut',
    libelle: 'Commande',
    largeur: '27%',
    alignement: 'texte',
    rendu: (f) => {
      const statut = statutFournisseur(f);
      return <span className={statut.classe}>{statut.texte}</span>;
    },
    titre: (f) => statutFournisseur(f).texte,
  },
];

export default function Fournisseurs() {
  const [etatListe, setEtatListe] = useState<EtatListe>({ statut: 'chargement' });
  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [brouillon, setBrouillon] = useState<Brouillon>(BROUILLON_VIDE);
  const [champsEnErreur, setChampsEnErreur] = useState<Record<string, string>>({});
  const [erreurFormulaire, setErreurFormulaire] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState<EtatEnregistrement>({ phase: 'inchange' });
  const [afficherInactifs, setAfficherInactifs] = useState(false);

  const formulaireRef = useRef<HTMLFormElement>(null);

  const charger = useCallback(async (): Promise<Fournisseur[]> => {
    const reponse = await requeteApi<unknown>('/fournisseurs');
    return schemaListeFournisseurs.parse(reponse).data;
  }, []);

  useEffect(() => {
    let annule = false;

    charger()
      .then((fournisseurs) => {
        if (annule) return;
        setEtatListe({ statut: 'pret', fournisseurs });
      })
      .catch((erreur: unknown) => {
        if (annule) return;
        setEtatListe({
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
  }, [charger]);

  // `useMemo` et non un ternaire : un `[]` recréé à chaque rendu annulerait les
  // `useMemo` qui en dépendent (D-047).
  const fournisseurs = useMemo(
    () => (etatListe.statut === 'pret' ? etatListe.fournisseurs : []),
    [etatListe],
  );

  const visibles = useMemo(
    () => (afficherInactifs ? fournisseurs : fournisseurs.filter((f) => f.actif)),
    [fournisseurs, afficherInactifs],
  );

  const selection = useMemo(
    () => fournisseurs.find((f) => f.id === selectionId) ?? null,
    [fournisseurs, selectionId],
  );

  function choisir(fournisseur: Fournisseur): void {
    setSelectionId(fournisseur.id);
    setBrouillon(versBrouillon(fournisseur));
    setChampsEnErreur({});
    setErreurFormulaire(null);
    setEnregistrement({ phase: 'inchange' });
  }

  function nouveau(): void {
    setSelectionId(null);
    setBrouillon(BROUILLON_VIDE);
    setChampsEnErreur({});
    setErreurFormulaire(null);
    setEnregistrement({ phase: 'inchange' });
    // Le focus part sur le premier champ : creer un fournisseur ne doit pas
    // demander de reprendre la souris (CLAUDE.md §3 regle 10).
    window.setTimeout(() => formulaireRef.current?.querySelector('input')?.focus(), 0);
  }

  function modifier<C extends keyof Brouillon>(champ: C, valeur: Brouillon[C]): void {
    setBrouillon((precedent) => ({ ...precedent, [champ]: valeur }));
    setEnregistrement({ phase: 'modifie' });
    // Validation À LA SAUVEGARDE, jamais en direct — voir
    // `champsEnErreurApresModification` (`../composants/formulaire`) pour la
    // justification complète, partagée avec Ingrédients, Produits, Lieux de
    // marché, Concurrents, Équipements et Nomenclature de vente. Taper UN
    // caractère effaçait auparavant le marquage rouge et `aria-invalid` même
    // si la valeur restait fautive (défaut mesuré le 30/07/2026) : ce n'est
    // ni de la validation en direct, ni de la validation à la sauvegarde.
    setChampsEnErreur(champsEnErreurApresModification);
  }

  /**
   * Traduit le brouillon en corps de requete. Rend `null` et signale le champ
   * fautif si un montant ou un entier n'est pas lisible — jamais de valeur
   * devinee : un zero silencieux fausserait un franco de port.
   */
  function corpsDepuisBrouillon(): Record<string, unknown> | null {
    const erreurs = erreursSaisieFournisseur(brouillon);

    if (Object.keys(erreurs).length > 0) {
      setChampsEnErreur(erreurs);
      // Défaut mesuré (recette clavier du 30/07/2026) : `setChampsEnErreur`
      // sans `focaliserPremierChampFautif` juste après laissait le focus sur
      // le bouton « Enregistrer » plutôt que de guider vers le champ fautif —
      // même défaut que celui corrigé sur Produits.tsx.
      focaliserPremierChampFautif(erreurs);
      return null;
    }

    // `erreursSaisieFournisseur` vient de vérifier que ces trois champs sont
    // lisibles : ne recalcule aucune erreur, redérive seulement les mêmes
    // valeurs (même patron que `corpsSaisieProduit`, `Produits.tsx`).
    return {
      nom: brouillon.nom,
      type: brouillon.type,
      email: brouillon.email,
      telephone: brouillon.telephone,
      adresse: brouillon.adresse,
      delaiLivraisonJours: Number.parseInt(brouillon.delaiLivraisonJours.trim(), 10),
      francoDePortCents:
        brouillon.francoDePort.trim() === '' ? null : parserEuros(brouillon.francoDePort),
      commandeMinimumCents:
        brouillon.commandeMinimum.trim() === '' ? null : parserEuros(brouillon.commandeMinimum),
      notes: brouillon.notes,
    };
  }

  /** Donne le focus au premier champ fautif (docs/07 §4.7). */
  function focaliserPremierChampFautif(champs: Record<string, string>): void {
    const premier = Object.keys(champs)[0];
    if (premier === undefined) return;
    const element = formulaireRef.current?.querySelector<HTMLElement>(`[name="${premier}"]`);
    element?.focus();
  }

  function enregistrer(): void {
    const corps = corpsDepuisBrouillon();
    if (corps === null) return;

    setErreurFormulaire(null);
    setEnregistrement({ phase: 'enregistrement' });

    const chemin = selectionId === null ? '/fournisseurs' : `/fournisseurs/${selectionId}`;
    const methode = selectionId === null ? 'POST' : 'PATCH';

    requeteApi<unknown>(chemin, { method: methode, body: JSON.stringify(corps) })
      .then(async (reponse) => {
        const enregistre = schemaFournisseur.parse(reponse);
        const liste = await charger();
        setEtatListe({ statut: 'pret', fournisseurs: liste });
        setSelectionId(enregistre.id);
        setBrouillon(versBrouillon(enregistre));
        setChampsEnErreur({});
        setEnregistrement({ phase: 'enregistre', heure: heureCourante() });
      })
      .catch((erreur: unknown) => {
        setEnregistrement({ phase: 'modifie' });
        if (erreur instanceof ErreurApi && erreur.champs !== undefined) {
          setChampsEnErreur(erreur.champs);
          focaliserPremierChampFautif(erreur.champs);
          // Pas de bandeau EN PLUS des messages en ligne : un double
          // signalement fait chercher l'erreur deux fois (docs/07 §4.7).
          return;
        }
        setErreurFormulaire(
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
        );
      });
  }

  function basculerActivite(): void {
    if (selection === null) return;
    const cible = !selection.actif;

    requeteApi<unknown>(`/fournisseurs/${selection.id}/activite`, {
      method: 'PATCH',
      body: JSON.stringify({ actif: cible }),
    })
      .then(async (reponse) => {
        const modifie = schemaFournisseur.parse(reponse);
        const liste = await charger();
        setEtatListe({ statut: 'pret', fournisseurs: liste });
        setBrouillon(versBrouillon(modifie));
        setEnregistrement({ phase: 'enregistre', heure: heureCourante() });
      })
      .catch((erreur: unknown) => {
        setErreurFormulaire(
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
        );
      });
  }

  return (
    <div
      className="flex flex-col gap-bloc"
      onKeyDown={(evenement) => {
        // Ctrl+S : raccourci d'enregistrement universel (docs/07 §4.6). Ni
        // Ctrl+N ni Ctrl+T ni Ctrl+W, qui sont reserves au navigateur.
        if ((evenement.ctrlKey || evenement.metaKey) && evenement.key === 's') {
          evenement.preventDefault();
          enregistrer();
        }
      }}
    >
      <div className="flex h-rangee items-center justify-between">
        <h1 className="text-lg text-ink">Fournisseurs</h1>
        <button
          type="button"
          onClick={nouveau}
          className="h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover"
        >
          Nouveau fournisseur
        </button>
      </div>

      {/*
        Point de rupture a `lg` (1024 px) et JAMAIS a `xl` (1280 px) : la cible
        de conception est un viewport EFFECTIF de 1280x720 (Windows a 150 %),
        donc un `xl:` ferait retomber l'ecran en colonne unique exactement a la
        resolution de travail.

        Repartition 5/4 et non 50/50 : a 1280 px, deux colonnes egales laissent
        ~460 px au tableau, ou « Grossiste » se tronque. Le tableau a besoin de
        plus de largeur que le formulaire, dont les champs vont deja par deux.

        `minmax(0, …)` et non `5fr_4fr` tout court : un `fr` vaut
        `minmax(auto, Xfr)`, donc son plancher est la largeur de CONTENU MINIMAL
        de la colonne. Le formulaire de droite contient des libelles longs qui
        poussaient ce plancher au-dessus de sa part — resultat, la colonne de
        droite s'elargissait et le tableau RETRECISSAIT, exactement l'inverse de
        l'intention. `minmax(0, …)` autorise la colonne a passer sous son contenu
        minimal, et le ratio est respecte.
      */}
      <div className="grid grid-cols-1 items-start gap-bloc lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        {/* ═══ Liste ══════════════════════════════════════════════════════ */}
        <Panneau titre="Liste des fournisseurs" sansRembourrage>
          <div className="border-b border-line px-4 py-2">
            <label className="flex items-center gap-groupe text-sm text-ink-2">
              <input
                type="checkbox"
                checked={afficherInactifs}
                onChange={(evenement) => setAfficherInactifs(evenement.target.checked)}
              />
              Afficher aussi les fournisseurs désactivés
            </label>
          </div>

          {etatListe.statut === 'chargement' && (
            <p className="px-4 py-2 text-sm text-ink-3">Chargement des fournisseurs…</p>
          )}

          {etatListe.statut === 'erreur' && (
            <div className="px-4 py-2">
              <MessageErreur message={etatListe.message} />
            </div>
          )}

          {etatListe.statut === 'pret' && (
            <Tableau
              colonnes={COLONNES}
              lignes={visibles}
              cleLigne={(f) => f.id}
              total={fournisseurs.length}
              libelleEntite="fournisseurs"
              {...(selectionId !== null ? { ligneSelectionneeCle: selectionId } : {})}
              onSelectionnerLigne={choisir}
              etatVide={
                fournisseurs.length > 0 ? (
                  <EtatVide
                    variante="filtre"
                    explicationFiltre={
                      fournisseurs.length > 1
                        ? `Tous les fournisseurs enregistrés (${fournisseurs.length}) sont désactivés et masqués par le filtre.`
                        : "L'unique fournisseur enregistré est désactivé et masqué par le filtre."
                    }
                    onReinitialiser={() => setAfficherInactifs(true)}
                  />
                ) : (
                  <EtatVide
                    variante="premier-lancement"
                    titre="Aucun fournisseur enregistré"
                    explication="Créez le meunier, le grossiste et les producteurs chez qui vous vous approvisionnez. Ce sont eux qui reçoivent les bons de commande."
                    action={{ libelle: 'Créer un fournisseur', onClick: nouveau }}
                  />
                )
              }
            />
          )}
        </Panneau>

        {/* ═══ Fiche ══════════════════════════════════════════════════════ */}
        <Panneau titre={selection === null ? 'Nouveau fournisseur' : selection.nom}>
          <form
            ref={formulaireRef}
            className="flex flex-col gap-bloc"
            onSubmit={(evenement) => {
              evenement.preventDefault();
              enregistrer();
            }}
          >
            <ChampTexte
              nom="nom"
              libelle="Nom"
              valeur={brouillon.nom}
              onChange={(v) => modifier('nom', v)}
              erreur={champsEnErreur['nom']}
              obligatoire
            />

            {/* Deux champs par rangee partout ou c'est lisible : a 720 px de
                haut, la HAUTEUR est la ressource rare (docs/07 §4.4). */}
            <div className="grid grid-cols-2 gap-groupe">
              <label className="flex flex-col gap-groupe text-sm text-ink-2">
                Type
                <select
                  name="type"
                  className="h-controle rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                  value={brouillon.type}
                  onChange={(evenement) =>
                    modifier('type', evenement.target.value as TypeFournisseur)
                  }
                >
                  {TYPES.map((type) => (
                    <option key={type.valeur} value={type.valeur}>
                      {type.libelle}
                    </option>
                  ))}
                </select>
              </label>
              <ChampTexte
                nom="delaiLivraisonJours"
                libelle="Délai de livraison (j)"
                valeur={brouillon.delaiLivraisonJours}
                onChange={(v) => modifier('delaiLivraisonJours', v)}
                erreur={champsEnErreur['delaiLivraisonJours']}
                numerique="entier"
              />
            </div>

            <ChampTexte
              nom="email"
              libelle="Adresse e-mail"
              valeur={brouillon.email}
              onChange={(v) => modifier('email', v)}
              erreur={champsEnErreur['email']}
              aide="C'est à cette adresse que partent les bons de commande. Sans elle, la commande devra être passée autrement."
            />

            <div className="grid grid-cols-2 gap-groupe">
              <ChampTexte
                nom="telephone"
                libelle="Téléphone"
                valeur={brouillon.telephone}
                onChange={(v) => modifier('telephone', v)}
                erreur={champsEnErreur['telephone']}
              />
              <ChampTexte
                nom="adresse"
                libelle="Adresse"
                valeur={brouillon.adresse}
                onChange={(v) => modifier('adresse', v)}
                erreur={champsEnErreur['adresse']}
              />
            </div>

            <div className="grid grid-cols-2 gap-groupe">
              <ChampTexte
                nom="francoDePortCents"
                libelle="Franco de port (€)"
                valeur={brouillon.francoDePort}
                onChange={(v) => modifier('francoDePort', v)}
                erreur={champsEnErreur['francoDePortCents']}
                numerique="decimal"
              />
              <ChampTexte
                nom="commandeMinimumCents"
                libelle="Commande minimum (€)"
                valeur={brouillon.commandeMinimum}
                onChange={(v) => modifier('commandeMinimum', v)}
                erreur={champsEnErreur['commandeMinimumCents']}
                numerique="decimal"
              />
            </div>

            <ChampTexte
              nom="notes"
              libelle="Notes"
              valeur={brouillon.notes}
              onChange={(v) => modifier('notes', v)}
              erreur={champsEnErreur['notes']}
            />

            {erreurFormulaire !== null && <MessageErreur message={erreurFormulaire} />}

            <div className="flex items-center justify-between border-t border-line pt-3">
              <IndicateurEnregistrement etat={enregistrement} />
              <div className="flex items-center gap-groupe">
                {selection !== null && (
                  <button
                    type="button"
                    onClick={basculerActivite}
                    className="h-controle rounded-sm border border-line-field bg-surface px-3 text-sm font-medium text-ink-2 hover:bg-surface-sunken"
                  >
                    {selection.actif ? 'Désactiver' : 'Réactiver'}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={enregistrement.phase === 'enregistrement'}
                  className="h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:bg-ink-4"
                >
                  Enregistrer
                </button>
              </div>
            </div>

            {selection !== null && (
              <div className="flex flex-col gap-groupe text-xs text-ink-3">
                {/* Ce que la desactivation va retirer des listes de commande :
                    le chiffre doit etre visible AVANT de cliquer, pas decouvert
                    apres. */}
                <p>
                  {selection.nbConditionnements === 0
                    ? 'Aucun conditionnement n’est référencé chez ce fournisseur.'
                    : `${selection.nbConditionnements} conditionnement${selection.nbConditionnements > 1 ? 's' : ''} référencé${selection.nbConditionnements > 1 ? 's' : ''} chez ce fournisseur.`}
                </p>
                {/* On BLOQUE, on ne supprime jamais : le dire a l'ecran evite
                    que l'utilisateur cherche un bouton « Supprimer » qui
                    n'existera jamais, et explique pourquoi. */}
                <p>
                  Un fournisseur ne se supprime pas : il est référencé par les lots déjà reçus, dont
                  la traçabilité doit rester lisible. Désactivé, il disparaît des listes de choix
                  mais reste dans l’historique.
                </p>
              </div>
            )}
          </form>
        </Panneau>
      </div>
    </div>
  );
}

/**
 * `ChampTexte` et `IndicateurEnregistrement` locaux — SUPPRIMÉS (01/08/2026,
 * mission « composants partagés ») au profit de `../composants/champs-
 * formulaire`, qui fusionne les six variantes historiques de `ChampTexte`
 * (voir l'en-tête de ce fichier partagé pour ce que la fusion devait
 * préserver). `numerique` y est devenu `'entier' | 'decimal'` — ce fournisseur
 * utilisait `inputMode: 'numeric'` pour les trois champs numériques : un
 * délai de livraison en jours entiers (`numerique="entier"`), un franco de
 * port et une commande minimum en euros (`numerique="decimal"`).
 */
