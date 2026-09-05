import { useEffect, useRef, useState } from 'react';
import {
  formaterDate,
  formaterEuros,
  formaterPourcent,
  parserEuros,
  GLYPHE_STATUT,
  ouTiret,
  statutParPlafond,
  type ChampsEnErreur,
  type GrandeurObjectif,
  type Statut,
  type StatutObjectif,
} from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { EtatVide } from '../composants/EtatVide';
import { EncartErreur, MessageErreur } from '../composants/EncartErreur';
import { champsEnErreurApresModification } from '../composants/formulaire';
import { ErreurApi, requeteApi } from '../lib/api';
import { aujourdHui } from '../lib/dates';
import type {
  ObjectifLigneContrat,
  ResultatAnticipationSeuilContrat,
  ResultatNiveauContrat,
  ResultatSerieContrat,
  SuccesContrat,
} from '@batte/core';
import { schemaListeObjectifs, schemaSucces } from '@batte/core';

/**
 * Écran Objectifs et succès (fiche 18).
 *
 * Aucune refonte visuelle ici (fiches 02 et 10 restent programmées en
 * dernier) : un écran de LECTURE sobre, dans les mêmes conventions que
 * `QualiteModele.tsx`, à l'exception du bloc « Objectifs » qui est un écran de
 * SAISIE (créer/annuler une cible) — pas de calcul métier ici non plus
 * (CLAUDE.md §3 règle 1) : `evaluerObjectif` tourne côté serveur, cet écran
 * n'affiche que le résultat déjà calculé de `/api/objectifs`.
 *
 * Le bloc « chiffre d'affaires cumulé » n'affiche JAMAIS le niveau seul
 * (fiche §2.1 — « un palier de CA ne doit jamais s'afficher nu ») : le
 * contexte des seuils légaux est un champ NON-OPTIONNEL du contrat
 * (`schemaNiveauChiffreAffaires`), donc structurellement toujours présent.
 * La même règle vaut pour un OBJECTIF de chiffre d'affaires (fiche §4) :
 * `LigneObjectif` ci-dessous rappelle systématiquement ce même contexte à
 * côté de toute ligne `grandeur === 'chiffre_affaires'`.
 */

/** Même calcul que `statutSeuil` de `pages/TableauDeBord.tsx`, dupliqué à
 * dessein : ce fichier est modifié par d'autres agents en parallèle, s'y
 * coupler créerait une dépendance fragile entre deux écrans indépendants. */
function statutSeuil(
  seuil: {
    readonly realiseCents: number;
    readonly plafondCents: number;
    readonly depassementProjete: boolean;
  },
  seuilAlerteBp: number,
): Statut {
  const surLeRealise = statutParPlafond(seuil.realiseCents, seuil.plafondCents, seuilAlerteBp);
  // Le pire des deux signaux : la trajectoire (projection) peut alerter avant
  // que le réalisé instantané ne le fasse — voir `pages/TableauDeBord.tsx`.
  if (surLeRealise === 'depassement' || seuil.depassementProjete) return 'depassement';
  return surLeRealise;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Objectifs (budget, fiche §4)
   ═══════════════════════════════════════════════════════════════════════════ */

const LIBELLE_GRANDEUR_OBJECTIF: Readonly<Record<GrandeurObjectif, string>> = {
  chiffre_affaires: 'Chiffre d’affaires',
  marge_nette: 'Marge nette',
  nombre_sessions: 'Nombre de sessions',
  cout_matiere_par_crepe: 'Coût matière par crêpe',
};

const GRANDEURS_OBJECTIF_OPTIONS = Object.keys(LIBELLE_GRANDEUR_OBJECTIF) as GrandeurObjectif[];

/**
 * Referme `objectifAnnuleId` (`schemaObjectifLigne`, docs/21-CHAMPS-NON-LUS.md
 * §5) : le badge « Correction » disait QU'un objectif venait d'être corrigé,
 * jamais LEQUEL — deux corrections sur la même grandeur (ex. deux
 * ajustements de la cible de marge nette) étaient indiscernables sans
 * comparer les dates à l'œil. Simple JOIN d'affichage sur la liste déjà
 * chargée, jamais un second calcul (CLAUDE.md §3 règle 1).
 *
 * Fonction PURE et exportée : son test prouve la résolution, pas le rendu
 * réel dans le DOM (celui-ci relève de `Objectifs.montage.test.tsx`).
 */
export function libelleCibleAnnulationObjectif(
  objectifAnnuleId: string | null,
  toutes: readonly ObjectifLigneContrat[],
): string | null {
  if (objectifAnnuleId === null) return null;
  const cible = toutes.find((o) => o.id === objectifAnnuleId);
  if (cible === undefined) return null;
  return (
    `corrige l’objectif « ${LIBELLE_GRANDEUR_OBJECTIF[cible.grandeur]} » du ` +
    `${formaterDate(cible.dateDebut)} → ${formaterDate(cible.dateFin)}`
  );
}

const LIBELLE_STATUT_OBJECTIF: Readonly<Record<StatutObjectif, string>> = {
  sans_donnee: 'Sans donnée',
  atteint: 'Atteint',
  en_cours: 'En cours',
  manque: 'Manqué',
};

/** Couleur de statut : `sans_donnee` reste neutre, ni alerte ni réussite —
 * une période qui n'a encore vu aucune session clôturée n'est ni un succès
 * ni un échec. */
const CLASSE_STATUT_OBJECTIF: Readonly<Record<StatutObjectif, string>> = {
  sans_donnee: 'text-ink-3',
  atteint: 'text-conforme',
  en_cours: 'text-alerte',
  manque: 'text-depassement',
};

/** Glyphe redondant (docs/07 §4.5) : `sans_donnee` n'a pas d'équivalent dans
 * l'échelle à trois états — aucun glyphe pour ce cas, même logique que
 * `CLASSE_STATUT_OBJECTIF` ci-dessus. */
const GLYPHE_STATUT_OBJECTIF: Readonly<Partial<Record<StatutObjectif, string>>> = {
  atteint: GLYPHE_STATUT.conforme,
  en_cours: GLYPHE_STATUT.alerte,
  manque: GLYPHE_STATUT.depassement,
};

/** Une seule grandeur (`nombre_sessions`) se compte en unités, les trois
 * autres sont des montants en centimes (CLAUDE.md §3 règle 3). */
function formaterValeurGrandeur(grandeur: GrandeurObjectif, valeur: number): string {
  if (grandeur === 'nombre_sessions') return `${valeur} session${valeur > 1 ? 's' : ''}`;
  return formaterEuros(valeur);
}

/** « 6 », « 12 » -> entier strictement positif. Jamais de décimales : un
 * nombre de sessions ne s'exprime qu'en unités entières. */
function parserEntierStrictPositif(saisie: string): number | null {
  const nettoye = saisie.trim();
  if (!/^\d+$/.test(nettoye)) return null;
  const valeur = Number.parseInt(nettoye, 10);
  return valeur > 0 ? valeur : null;
}

export type BrouillonObjectif = {
  readonly grandeur: GrandeurObjectif;
  readonly dateDebut: string;
  readonly dateFin: string;
  readonly valeurCible: string;
};

/**
 * Validation LOCALE du brouillon de création d'objectif, avant tout
 * aller-retour — même patron que `erreursSaisieProduit` (`Produits.tsx`) et
 * `erreursSaisieFournisseur` (`Fournisseurs.tsx`).
 *
 * Extraite en fonction PURE et exportée pour prouver, sans rendre l'écran,
 * quel champ une cible illisible ou une période inversée désigne EN PREMIER —
 * c'est ce nom de champ que `focaliserPremierChampFautifObjectif` doit
 * atteindre juste après `setChampsEnErreurObjectif` (défaut mesuré le
 * 30/07/2026 : un refus d'enregistrement affichait un bandeau de PAGE, le
 * focus restait sur le bouton « Enregistrer », et le champ « Cible » fautif
 * n'était marqué invalide nulle part).
 *
 * `dateFin` VIDE est une erreur À PART ENTIÈRE, pas seulement une période
 * inversée : la colonne `objectif.date_fin` est `NOT NULL` (packages/db/src/
 * schema.ts), donc une fin non choisie ne peut de toute façon jamais partir
 * en base — mais la bloquer ICI, avec un message qui dit POURQUOI, vaut mieux
 * qu'un 400 générique. C'est aussi ce qui rend impossible le défaut mesuré le
 * 30/07/2026 (Début et Fin tous deux pré-remplis à aujourd'hui) : le
 * formulaire n'ouvre plus jamais avec une fin déjà choisie à sa place — voir
 * l'état initial de `dateFinSaisie` dans le composant.
 */
export function erreursSaisieObjectif(brouillon: BrouillonObjectif): ChampsEnErreur {
  const erreurs: ChampsEnErreur = {};

  if (brouillon.dateDebut.trim() === '') {
    erreurs['dateDebut'] = 'Indiquez la date de début.';
  }

  if (brouillon.dateFin.trim() === '') {
    erreurs['dateFin'] =
      'Choisissez une date de fin : sans elle, cet objectif ne pourra jamais être évalué.';
  } else if (
    brouillon.dateDebut.trim() !== '' &&
    brouillon.dateDebut.trim() > brouillon.dateFin.trim()
  ) {
    erreurs['dateFin'] = 'La date de fin doit être postérieure ou égale à la date de début.';
  }

  const cibleValeur =
    brouillon.grandeur === 'nombre_sessions'
      ? parserEntierStrictPositif(brouillon.valeurCible)
      : parserEuros(brouillon.valeurCible);
  if (cibleValeur === null || cibleValeur <= 0) {
    erreurs['valeurCible'] =
      brouillon.grandeur === 'nombre_sessions'
        ? 'La cible doit être un nombre entier de sessions supérieur à zéro.'
        : 'La cible doit être un montant valide supérieur à zéro.';
  }

  return erreurs;
}

type EtatEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; succes: SuccesContrat };

/**
 * Message d'une erreur attrapée dans un `catch`, dupliqué à dessein depuis
 * `pages/Comptabilite.tsx` (`messageErreurApi`) — même raison que
 * `statutSeuil` ci-dessus : cet écran est modifié par d'autres agents en
 * parallèle, s'y coupler créerait une dépendance fragile entre deux écrans
 * indépendants.
 */
function messageErreur(erreur: unknown): string {
  return erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.';
}

type EtatObjectifs =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; lignes: ObjectifLigneContrat[] };

type EtatEcriture =
  { statut: 'inactif' } | { statut: 'en_cours' } | { statut: 'erreur'; message: string };

export default function Objectifs() {
  const [etat, setEtat] = useState<EtatEcran>({ statut: 'chargement' });

  useEffect(() => {
    let annule = false;

    requeteApi<unknown>('/objectifs/succes')
      .then((brut) => {
        if (annule) return;
        setEtat({ statut: 'pret', succes: schemaSucces.parse(brut) });
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

  // ─── Objectifs (budget, fiche §4) ────────────────────────────────────────
  const [etatObjectifs, setEtatObjectifs] = useState<EtatObjectifs>({ statut: 'chargement' });

  const [creationOuverte, setCreationOuverte] = useState(false);
  const [grandeurSaisie, setGrandeurSaisie] = useState<GrandeurObjectif>('chiffre_affaires');
  const [dateDebutSaisie, setDateDebutSaisie] = useState(aujourdHui);
  // VIDE, jamais `aujourdHui()` : défaut mesuré le 30/07/2026 — Début ET Fin
  // pré-remplis au même jour produisaient un objectif de « chiffre d'affaires
  // cumulé » qu'aucune session ne pourrait jamais valider si l'utilisateur ne
  // pensait pas à changer la fin. La doctrine du projet veut `null` plutôt
  // qu'une valeur par défaut plausible ; `objectif.date_fin` est `NOT NULL`
  // (packages/db/src/schema.ts, migration hors périmètre ce soir), donc ce
  // « null » ne peut vivre que côté ÉCRAN — un champ vide qui force un choix
  // actif, jamais transmis tel quel (voir `erreursSaisieObjectif`).
  const [dateFinSaisie, setDateFinSaisie] = useState('');
  const [valeurCibleSaisie, setValeurCibleSaisie] = useState('');
  const [notesSaisie, setNotesSaisie] = useState('');
  const [etatCreation, setEtatCreation] = useState<EtatEcriture>({ statut: 'inactif' });
  const [champsEnErreurObjectif, setChampsEnErreurObjectif] = useState<ChampsEnErreur>({});
  const formulaireObjectifRef = useRef<HTMLFormElement>(null);

  const [objectifEnAnnulationId, setObjectifEnAnnulationId] = useState<string | null>(null);
  const [motifAnnulation, setMotifAnnulation] = useState('');
  const [etatAnnulation, setEtatAnnulation] = useState<EtatEcriture>({ statut: 'inactif' });

  // Clavier (CLAUDE.md règle 10) : mêmes gestes que `pages/Comptabilite.tsx`
  // pour un panneau escamotable — le focus entre sur le premier champ à
  // l'ouverture, et revient au bouton bascule à la fermeture.
  const boutonNouvelObjectif = useRef<HTMLButtonElement>(null);
  const champGrandeurObjectif = useRef<HTMLSelectElement>(null);
  const champMotifAnnulationObjectif = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creationOuverte) champGrandeurObjectif.current?.focus();
  }, [creationOuverte]);

  useEffect(() => {
    if (objectifEnAnnulationId !== null) champMotifAnnulationObjectif.current?.focus();
  }, [objectifEnAnnulationId]);

  useEffect(() => {
    function surAppuiTouche(evenement: KeyboardEvent): void {
      if (evenement.key !== 'Escape') return;
      if (objectifEnAnnulationId !== null) {
        setObjectifEnAnnulationId(null);
        boutonNouvelObjectif.current?.focus();
        return;
      }
      if (creationOuverte) {
        setCreationOuverte(false);
        boutonNouvelObjectif.current?.focus();
      }
    }
    window.addEventListener('keydown', surAppuiTouche);
    return () => window.removeEventListener('keydown', surAppuiTouche);
  }, [objectifEnAnnulationId, creationOuverte]);

  function chargerObjectifs(): void {
    setEtatObjectifs({ statut: 'chargement' });
    requeteApi<unknown>('/objectifs')
      .then((brut) => {
        setEtatObjectifs({ statut: 'pret', lignes: schemaListeObjectifs.parse(brut).data });
      })
      .catch((erreur: unknown) => {
        setEtatObjectifs({ statut: 'erreur', message: messageErreur(erreur) });
      });
  }

  useEffect(chargerObjectifs, []);

  /** Donne le focus au premier champ fautif (docs/07 §4.7) — même mécanisme
   * partagé qu'Ingrédients, Produits, Fournisseurs, Lieux de marché,
   * Concurrents, Équipements et Nomenclature de vente : `setChampsEnErreurObjectif`
   * n'est jamais appelée sans que celle-ci suive immédiatement. */
  function focaliserPremierChampFautifObjectif(champs: ChampsEnErreur): void {
    const premier = Object.keys(champs)[0];
    if (premier === undefined) return;
    formulaireObjectifRef.current?.querySelector<HTMLElement>(`[name="${premier}"]`)?.focus();
  }

  async function creerObjectifDepuisFormulaire(): Promise<void> {
    const erreurs = erreursSaisieObjectif({
      grandeur: grandeurSaisie,
      dateDebut: dateDebutSaisie,
      dateFin: dateFinSaisie,
      valeurCible: valeurCibleSaisie,
    });
    if (Object.keys(erreurs).length > 0) {
      setChampsEnErreurObjectif(erreurs);
      focaliserPremierChampFautifObjectif(erreurs);
      return;
    }
    if (etatCreation.statut === 'en_cours') return;

    const cibleValeur =
      grandeurSaisie === 'nombre_sessions'
        ? parserEntierStrictPositif(valeurCibleSaisie)
        : parserEuros(valeurCibleSaisie);
    // `erreursSaisieObjectif` vient de garantir que `cibleValeur` est non nul
    // et strictement positif : cette re-dérivation ne recalcule aucune règle,
    // elle relit seulement la même valeur (même patron que `corpsSaisieProduit`,
    // `Produits.tsx`). La garde reste explicite pour le typeur : jamais de `!`.
    if (cibleValeur === null) return;

    setEtatCreation({ statut: 'en_cours' });
    setChampsEnErreurObjectif({});
    try {
      const notesPropres = notesSaisie.trim();
      // `schemaCreationObjectif` normalise déjà `''` en `null` côté serveur —
      // envoyer directement la chaîne (jamais `undefined`) reste valide.
      await requeteApi('/objectifs', {
        method: 'POST',
        body: JSON.stringify({
          grandeur: grandeurSaisie,
          dateDebut: dateDebutSaisie,
          dateFin: dateFinSaisie,
          valeurCible: cibleValeur,
          notes: notesPropres === '' ? null : notesPropres,
        }),
      });
      setEtatCreation({ statut: 'inactif' });
      setValeurCibleSaisie('');
      setNotesSaisie('');
      setCreationOuverte(false);
      boutonNouvelObjectif.current?.focus();
      chargerObjectifs();
    } catch (erreur: unknown) {
      // Un refus DE CHAMP (422 avec `champs`) se marque sur le champ fautif,
      // exactement comme un refus local — jamais un bandeau de page qui ne
      // dit pas LEQUEL des champs est en cause (défaut mesuré le 30/07/2026).
      if (erreur instanceof ErreurApi && erreur.champs !== undefined) {
        setChampsEnErreurObjectif(erreur.champs);
        focaliserPremierChampFautifObjectif(erreur.champs);
        return;
      }
      setEtatCreation({ statut: 'erreur', message: messageErreur(erreur) });
    }
  }

  async function confirmerAnnulationObjectif(objectifId: string): Promise<void> {
    if (motifAnnulation.trim() === '') {
      setEtatAnnulation({
        statut: 'erreur',
        message: 'Indiquez pourquoi cet objectif est annulé ou corrigé.',
      });
      return;
    }
    setEtatAnnulation({ statut: 'en_cours' });
    try {
      await requeteApi(`/objectifs/${objectifId}/annuler`, {
        method: 'POST',
        body: JSON.stringify({ motif: motifAnnulation.trim() }),
      });
      setObjectifEnAnnulationId(null);
      setMotifAnnulation('');
      setEtatAnnulation({ statut: 'inactif' });
      boutonNouvelObjectif.current?.focus();
      chargerObjectifs();
    } catch (erreur: unknown) {
      setEtatAnnulation({ statut: 'erreur', message: messageErreur(erreur) });
    }
  }

  return (
    <div className="flex flex-col gap-bloc">
      <h1 className="flex h-rangee items-center text-lg text-ink">Objectifs et succès</h1>

      {/* ═══ Objectifs (budget, fiche §4) — indépendant des succès : une
          panne de `/objectifs/succes` ne doit pas emporter la possibilité de
          se fixer une cible. ═══ */}
      <Panneau titre="Objectifs" sansRembourrage>
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          {etatObjectifs.statut === 'pret' ? (
            <p className="text-xs text-ink-3">
              {etatObjectifs.lignes.length} ligne{etatObjectifs.lignes.length <= 1 ? '' : 's'}.
            </p>
          ) : (
            <span />
          )}
          <button
            type="button"
            ref={boutonNouvelObjectif}
            onClick={() => setCreationOuverte((v) => !v)}
            aria-expanded={creationOuverte}
            className="h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Nouvel objectif
          </button>
        </div>

        {creationOuverte && (
          <form
            ref={formulaireObjectifRef}
            onSubmit={(e) => {
              e.preventDefault();
              void creerObjectifDepuisFormulaire();
            }}
            className="border-b border-line px-4 py-3"
          >
            <div className="flex flex-wrap items-end gap-bloc">
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="objectif-grandeur"
              >
                Grandeur
                <select
                  id="objectif-grandeur"
                  name="grandeur"
                  ref={champGrandeurObjectif}
                  className="h-controle w-52 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                  value={grandeurSaisie}
                  onChange={(e) => {
                    setGrandeurSaisie(e.target.value as GrandeurObjectif);
                    // Changer de grandeur change ce que « Cible » VEUT DIRE
                    // (sessions ou montant) : effacement complet plutôt que
                    // `champsEnErreurApresModification`, même exception que
                    // `changerNature` dans `Produits.tsx`.
                    setChampsEnErreurObjectif({});
                  }}
                >
                  {GRANDEURS_OBJECTIF_OPTIONS.map((g) => (
                    <option key={g} value={g}>
                      {LIBELLE_GRANDEUR_OBJECTIF[g]}
                    </option>
                  ))}
                </select>
              </label>
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="objectif-date-debut"
              >
                Début
                <input
                  id="objectif-date-debut"
                  name="dateDebut"
                  type="date"
                  className={`h-controle w-40 rounded-sm border bg-surface px-2 text-base text-ink ${
                    champsEnErreurObjectif['dateDebut'] === undefined
                      ? 'border-line-field'
                      : 'border-depassement'
                  }`}
                  value={dateDebutSaisie}
                  onChange={(e) => {
                    setDateDebutSaisie(e.target.value);
                    setChampsEnErreurObjectif(champsEnErreurApresModification);
                  }}
                  aria-invalid={champsEnErreurObjectif['dateDebut'] !== undefined}
                />
                {champsEnErreurObjectif['dateDebut'] !== undefined && (
                  <span className="text-xs text-depassement">
                    {champsEnErreurObjectif['dateDebut']}
                  </span>
                )}
              </label>
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="objectif-date-fin"
              >
                Fin
                <input
                  id="objectif-date-fin"
                  name="dateFin"
                  type="date"
                  className={`h-controle w-40 rounded-sm border bg-surface px-2 text-base text-ink ${
                    champsEnErreurObjectif['dateFin'] === undefined
                      ? 'border-line-field'
                      : 'border-depassement'
                  }`}
                  value={dateFinSaisie}
                  onChange={(e) => {
                    setDateFinSaisie(e.target.value);
                    setChampsEnErreurObjectif(champsEnErreurApresModification);
                  }}
                  aria-invalid={champsEnErreurObjectif['dateFin'] !== undefined}
                />
                {champsEnErreurObjectif['dateFin'] !== undefined ? (
                  <span className="text-xs text-depassement">
                    {champsEnErreurObjectif['dateFin']}
                  </span>
                ) : (
                  <span className="text-2xs text-ink-3">Aucun défaut : à choisir vous-même.</span>
                )}
              </label>
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="objectif-cible"
              >
                Cible ({grandeurSaisie === 'nombre_sessions' ? 'sessions' : '€'})
                <input
                  id="objectif-cible"
                  name="valeurCible"
                  type="text"
                  inputMode={grandeurSaisie === 'nombre_sessions' ? 'numeric' : 'decimal'}
                  className={`num h-controle w-32 rounded-sm border bg-surface px-2 text-base text-ink ${
                    champsEnErreurObjectif['valeurCible'] === undefined
                      ? 'border-line-field'
                      : 'border-depassement'
                  }`}
                  value={valeurCibleSaisie}
                  onChange={(e) => {
                    setValeurCibleSaisie(e.target.value);
                    setChampsEnErreurObjectif(champsEnErreurApresModification);
                  }}
                  aria-invalid={champsEnErreurObjectif['valeurCible'] !== undefined}
                />
                {champsEnErreurObjectif['valeurCible'] !== undefined && (
                  <span className="text-xs text-depassement">
                    {champsEnErreurObjectif['valeurCible']}
                  </span>
                )}
              </label>
              <label
                className="flex flex-col gap-groupe text-sm text-ink-2"
                htmlFor="objectif-notes"
              >
                Notes (facultatif)
                <input
                  id="objectif-notes"
                  name="notes"
                  type="text"
                  className="h-controle w-56 rounded-sm border border-line-field bg-surface px-2 text-base text-ink"
                  value={notesSaisie}
                  onChange={(e) => setNotesSaisie(e.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={etatCreation.statut === 'en_cours'}
                className="flex h-controle w-40 items-center justify-center rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {etatCreation.statut === 'en_cours' ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
            {grandeurSaisie === 'chiffre_affaires' && (
              // Fiche §2.1 : un objectif de CA n'est jamais un plafond, mais
              // il ne s'affiche jamais nu non plus — rappel au point de
              // saisie, contexte complet affiché ensuite sur chaque ligne.
              <p className="mt-2 text-2xs text-ink-3">
                Un objectif de chiffre d’affaires n’est pas une limite : grossir reste le but.
                Chaque ligne ci-dessous rappellera systématiquement où en sont les seuils légaux
                (franchise TVA, Airbag, cotisation réduite) à côté de la cible.
              </p>
            )}
            {etatCreation.statut === 'erreur' && (
              <div className="mt-2">
                <MessageErreur message={etatCreation.message} />
              </div>
            )}
          </form>
        )}

        {etatObjectifs.statut === 'chargement' && (
          <p className="px-4 py-2 text-sm text-ink-3">Chargement…</p>
        )}
        {etatObjectifs.statut === 'erreur' && (
          <div className="px-4 py-2">
            <MessageErreur message={etatObjectifs.message} />
          </div>
        )}
        {etatObjectifs.statut === 'pret' &&
          (etatObjectifs.lignes.length === 0 ? (
            <EtatVide
              variante="premier-lancement"
              titre="Aucun objectif fixé"
              explication="Une cible de chiffre d’affaires, de marge nette, de coût matière par crêpe ou de nombre de sessions apparaîtra ici, avec l’écart au réalisé suivi automatiquement sur sa période."
            />
          ) : (
            <ul className="flex flex-col">
              {etatObjectifs.lignes.map((ligne) => (
                <li key={ligne.id} className="border-b border-line px-4 py-3 last:border-b-0">
                  <LigneObjectif
                    ligne={ligne}
                    toutesLesLignes={etatObjectifs.lignes}
                    contexteSeuilsLegaux={
                      etat.statut === 'pret'
                        ? etat.succes.niveauChiffreAffaires.contexteSeuilsLegaux
                        : null
                    }
                    peutAnnuler={!ligne.estAnnule && !ligne.estAnnulation}
                    onDemanderAnnulation={() => {
                      setObjectifEnAnnulationId((precedent) =>
                        precedent === ligne.id ? null : ligne.id,
                      );
                      setMotifAnnulation('');
                      setEtatAnnulation({ statut: 'inactif' });
                    }}
                  />
                  {objectifEnAnnulationId === ligne.id && (
                    <div className="mt-groupe border-t border-line bg-surface-sunken px-3 py-3">
                      <p className="text-sm text-ink-2">
                        Annuler cet objectif — une contre-écriture est créée, la ligne d’origine
                        reste visible.
                      </p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void confirmerAnnulationObjectif(ligne.id);
                        }}
                        className="mt-groupe flex items-end gap-groupe"
                      >
                        <input
                          type="text"
                          ref={champMotifAnnulationObjectif}
                          aria-label="Motif de l’annulation"
                          placeholder="Motif de l’annulation ou de la correction"
                          className="h-controle flex-1 rounded-sm border border-line-field bg-surface px-2 text-sm text-ink"
                          value={motifAnnulation}
                          onChange={(e) => setMotifAnnulation(e.target.value)}
                        />
                        <button
                          type="submit"
                          disabled={etatAnnulation.statut === 'en_cours'}
                          className="h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Confirmer
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setObjectifEnAnnulationId(null);
                            boutonNouvelObjectif.current?.focus();
                          }}
                          className="h-controle rounded-sm border border-line-field px-3 text-sm text-ink-2 hover:bg-surface"
                        >
                          Annuler la saisie
                        </button>
                      </form>
                      {etatAnnulation.statut === 'erreur' && (
                        <div className="mt-2">
                          <MessageErreur message={etatAnnulation.message} />
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ))}
      </Panneau>

      {etat.statut === 'chargement' && <p className="text-sm text-ink-3">Chargement des succès…</p>}

      {/* Les QUATRE encarts ci-dessous (`Contenu`, plus bas) viennent d'UN
          SEUL appel à `/objectifs/succes` : une panne y est donc commune aux
          quatre. Chacun garde néanmoins SON PROPRE titre — exactement ceux
          que `Contenu` rend une fois les données prêtes — plutôt qu'un
          bandeau unique sans cadre qui aurait fait disparaître les quatre
          encarts à la fois (défaut corrigé, `composants/EncartErreur.tsx`). */}
      {etat.statut === 'erreur' && (
        <>
          <EncartErreur titre="Niveau — Chiffre d’affaires cumulé" message={etat.message} />
          <EncartErreur titre="Niveau — Ancienneté active" message={etat.message} />
          <EncartErreur titre="Succès" message={etat.message} />
          <EncartErreur titre="Anticipation d’un seuil légal" message={etat.message} />
        </>
      )}

      {etat.statut === 'pret' && <Contenu succes={etat.succes} />}
    </div>
  );
}

function NiveauBloc({ niveau, titre }: { niveau: ResultatNiveauContrat; titre: string }) {
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span className="text-3xl tabular-nums text-ink">{niveau.niveauActuel}</span>
        <span className="text-sm text-ink-3">
          {niveau.libelleNiveauActuel ?? 'Aucun palier atteint pour le moment'}
        </span>
      </div>
      {niveau.prochainPalier !== null && (
        <p className="mt-groupe text-sm text-ink-2">
          Prochain palier « {niveau.prochainPalier.libelle} » —{' '}
          {ouTiret(niveau.progressionVersProchainBp, (v) => formaterPourcent(v))} parcourus.
        </p>
      )}
      {niveau.prochainPalier === null && (
        <p className="mt-groupe text-sm text-ink-2">
          {titre} : tous les paliers connus sont dépassés.
        </p>
      )}
    </div>
  );
}

/**
 * Une ligne d'objectif (fiche §4). Pour `grandeur === 'chiffre_affaires'`, le
 * contexte des seuils légaux est TOUJOURS rendu dans le même bloc — jamais un
 * second écran, jamais un clic supplémentaire — c'est la garde-fou du §2.1 :
 * « un palier de CA ne doit jamais s'afficher nu ».
 */
function LigneObjectif({
  ligne,
  toutesLesLignes,
  contexteSeuilsLegaux,
  peutAnnuler,
  onDemanderAnnulation,
}: {
  ligne: ObjectifLigneContrat;
  /** Toutes les lignes chargées, pour résoudre `objectifAnnuleId` — voir
   * `libelleCibleAnnulationObjectif` ci-dessus. */
  toutesLesLignes: readonly ObjectifLigneContrat[];
  contexteSeuilsLegaux: SuccesContrat['niveauChiffreAffaires']['contexteSeuilsLegaux'] | null;
  peutAnnuler: boolean;
  onDemanderAnnulation: () => void;
}) {
  const { evaluation } = ligne;
  const libelleCible = libelleCibleAnnulationObjectif(ligne.objectifAnnuleId, toutesLesLignes);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-groupe">
        <div>
          <p className="text-sm font-medium text-ink">
            {LIBELLE_GRANDEUR_OBJECTIF[ligne.grandeur]}
            {ligne.estAnnulation && (
              <span className="ml-2 text-2xs uppercase text-alerte">Correction</span>
            )}
            {ligne.estAnnule && (
              <span className="ml-2 text-2xs uppercase text-depassement">Annulé</span>
            )}
          </p>
          <p className="text-xs text-ink-3">
            {formaterDate(ligne.dateDebut)} → {formaterDate(ligne.dateFin)}
          </p>
          {/* `objectifAnnuleId` résolu en texte VISIBLE, jamais en simple
              infobulle à la souris (CLAUDE.md §3 règle 10 : chaque écran doit
              rester utilisable au clavier) — voir
              `libelleCibleAnnulationObjectif` ci-dessus. */}
          {libelleCible !== null && <p className="text-2xs text-ink-3">{libelleCible}</p>}
        </div>
        <p className={`text-sm font-medium ${CLASSE_STATUT_OBJECTIF[evaluation.statut]}`}>
          {GLYPHE_STATUT_OBJECTIF[evaluation.statut] !== undefined && (
            <span aria-hidden="true">{GLYPHE_STATUT_OBJECTIF[evaluation.statut]} </span>
          )}
          {LIBELLE_STATUT_OBJECTIF[evaluation.statut]}
        </p>
      </div>

      <p className="mt-groupe text-sm text-ink-2">
        Cible {formaterValeurGrandeur(ligne.grandeur, ligne.valeurCible)} — réalisé{' '}
        {evaluation.realise === null
          ? 'sans donnée sur la période'
          : formaterValeurGrandeur(ligne.grandeur, evaluation.realise)}
        {evaluation.avancementBp !== null &&
          ` (${formaterPourcent(evaluation.avancementBp)} de la cible)`}
      </p>

      {ligne.notes !== null && <p className="mt-1 text-xs text-ink-3">{ligne.notes}</p>}

      {ligne.grandeur === 'chiffre_affaires' && (
        <div className="mt-groupe border-t border-line pt-groupe">
          {contexteSeuilsLegaux === null ? (
            <p className="text-xs text-ink-3">
              Contexte des seuils légaux indisponible pour le moment (succès non chargés).
            </p>
          ) : (
            <dl className="grid grid-cols-1 gap-groupe text-xs sm:grid-cols-3">
              {contexteSeuilsLegaux.data.map((seuil) => {
                const statut = statutSeuil(seuil, contexteSeuilsLegaux.meta.seuilAlerteBp);
                return (
                  <div key={seuil.cle}>
                    <dt className="flex items-center gap-1 uppercase text-ink-3">
                      <span aria-hidden="true">{GLYPHE_STATUT[statut]}</span>
                      {seuil.libelle}
                    </dt>
                    <dd className="tabular-nums text-ink-2">
                      {formaterEuros(seuil.realiseCents)} / {formaterEuros(seuil.plafondCents)} (
                      {formaterPourcent(seuil.partBp)})
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
      )}

      {peutAnnuler && (
        <button
          type="button"
          onClick={onDemanderAnnulation}
          className="mt-groupe h-controle rounded-sm border border-line-field px-2 text-xs text-ink-2 hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Annuler / corriger
        </button>
      )}
    </div>
  );
}

function BlocChiffreAffaires({
  niveauChiffreAffaires,
}: {
  niveauChiffreAffaires: SuccesContrat['niveauChiffreAffaires'];
}) {
  const { niveau, contexteSeuilsLegaux } = niveauChiffreAffaires;
  return (
    <Panneau titre="Niveau — Chiffre d’affaires cumulé">
      <p className="text-sm text-ink-2">
        {formaterEuros(niveau.valeurActuelle)} de chiffre d’affaires cumulé, toutes sessions
        clôturées confondues.
      </p>
      <div className="mt-groupe">
        <NiveauBloc niveau={niveau} titre="Chiffre d’affaires cumulé" />
      </div>

      {/* JAMAIS nu (fiche §2.1) : le contexte réglementaire accompagne toujours le niveau. */}
      <dl className="mt-bloc grid grid-cols-1 gap-groupe border-t border-line pt-bloc text-sm sm:grid-cols-2">
        {contexteSeuilsLegaux.data.map((seuil) => {
          const statut = statutSeuil(seuil, contexteSeuilsLegaux.meta.seuilAlerteBp);
          return (
            <div key={seuil.cle}>
              <dt className="flex items-center gap-2 text-2xs uppercase text-ink-3">
                <span aria-hidden="true">{GLYPHE_STATUT[statut]}</span>
                {seuil.libelle}
              </dt>
              <dd className="tabular-nums text-ink-2">
                {formaterEuros(seuil.realiseCents)} / {formaterEuros(seuil.plafondCents)} (
                {formaterPourcent(seuil.partBp)})
                {seuil.projectionFinAnneeCents !== null && (
                  <span className="ml-2 text-ink-3">
                    proj. {formaterEuros(seuil.projectionFinAnneeCents)}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-groupe text-xs text-ink-3">{contexteSeuilsLegaux.data[0]?.source ?? ''}</p>
    </Panneau>
  );
}

function BlocSerie({ serie }: { serie: ResultatSerieContrat }) {
  return (
    <div className="border-t border-line pt-groupe first:border-t-0 first:pt-0">
      <p className="text-sm font-medium text-ink">{serie.libelleAxe}</p>
      <p className="text-xs text-ink-3">
        Meilleure série : {serie.meilleureSerieLongueur} · série en cours :{' '}
        {serie.serieActuelleLongueur}
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {serie.paliers.map((palier) => (
          <li key={palier.niveau} className="flex items-center justify-between text-sm">
            <span className={palier.debloqueLe === null ? 'text-ink-3' : 'text-ink-2'}>
              {palier.debloqueLe === null ? '☆' : '★'} {palier.libelle}
            </span>
            <span className="tabular-nums text-ink-3">
              {ouTiret(palier.debloqueLe, (v) => formaterDate(v))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BlocAnticipation({
  resultats,
}: {
  resultats: readonly ResultatAnticipationSeuilContrat[];
}) {
  if (resultats.length === 0) {
    return (
      <p className="text-sm text-ink-2">
        Aucun seuil légal franchi pour l’instant : rien à mesurer sur l’anticipation.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-groupe">
      {resultats.map((resultat) => (
        <li key={resultat.cle} className="text-sm text-ink-2">
          <span className="font-medium text-ink">{resultat.libelle}</span> — franchi le{' '}
          {ouTiret(resultat.dateFranchissementReel, (v) => formaterDate(v))}
          {resultat.joursAnticipation !== null && resultat.joursAnticipation > 0 && (
            <span>
              {' '}
              · anticipé {resultat.joursAnticipation} jours à l’avance
              {
                /* `datePremiereAlerte` (`schemaResultatAnticipationSeuil`,
                   docs/21-CHAMPS-NON-LUS.md §2.4) : `joursAnticipation` dit
                   COMBIEN de jours d'avance, jamais la date calendaire exacte
                   du premier franchissement du seuil d'alerte à 80 % —
                   pourtant renvoyée, jamais affichée avant ce correctif. */
                resultat.datePremiereAlerte !== null &&
                  ` (dès le ${formaterDate(resultat.datePremiereAlerte)})`
              }
            </span>
          )}
          {resultat.joursAnticipation !== null && resultat.joursAnticipation <= 0 && (
            <span> · pas d’anticipation détectée</span>
          )}
          {resultat.niveau.libelleNiveauActuel !== null && (
            <span> — {resultat.niveau.libelleNiveauActuel}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Contenu({ succes }: { succes: SuccesContrat }) {
  return (
    <>
      <BlocChiffreAffaires niveauChiffreAffaires={succes.niveauChiffreAffaires} />

      <Panneau titre="Niveau — Ancienneté active">
        <p className="text-sm text-ink-2">
          {succes.niveauAnciennete.valeurActuelle} session
          {succes.niveauAnciennete.valeurActuelle > 1 ? 's' : ''} clôturée
          {succes.niveauAnciennete.valeurActuelle > 1 ? 's' : ''} au total.
        </p>
        <div className="mt-groupe">
          <NiveauBloc niveau={succes.niveauAnciennete} titre="Ancienneté active" />
        </div>
      </Panneau>

      <Panneau titre="Succès">
        <div className="flex flex-col gap-bloc">
          {succes.series.map((serie) => (
            <BlocSerie key={serie.cle} serie={serie} />
          ))}
        </div>
      </Panneau>

      <Panneau titre="Anticipation d’un seuil légal">
        <p className="text-sm text-ink-2">
          Pas le montant qu’on félicite : le fait de ne pas avoir été surpris par le changement de
          régime.
        </p>
        <div className="mt-groupe">
          <BlocAnticipation resultats={succes.anticipationSeuils} />
        </div>
      </Panneau>
    </>
  );
}
