import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BASE_POINTS,
  GLYPHE_STATUT,
  TIRET_ABSENT,
  formaterDate,
  schemaListeEvenements,
  type Evenement,
} from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { MessageErreur } from '../composants/EncartErreur';
import { EnveloppeChamp } from '../composants/champs-formulaire';
import { ErreurApi, requeteApi, type ChampsEnErreur } from '../lib/api';

/**
 * Ecran Evenements (docs/03 facteur 3 « Evenements », docs/06, docs/07).
 *
 * Aucun calcul metier ici (CLAUDE.md §3 regle 1) : la liste, l'impact ESTIME
 * et l'impact MESURE viennent tels quels de l'API. La seule arithmetique de
 * ce fichier est la conversion saisie <-> points de base, une conversion
 * d'UNITE d'affichage (comme `parserEuros` dans packages/core), jamais une
 * regle de gestion : 13000 points de base ne veut rien dire pour
 * l'utilisateur, « +30 % » ou « × 1,30 » si.
 *
 * Distinction centrale demandee pour cet ecran : l'impact ESTIME est une
 * intuition (encre secondaire), l'impact MESURE est une observation (encre
 * pleine). Les deux restent deux colonnes separees plutot qu'une valeur
 * fusionnee — fusionner effacerait justement la distinction a montrer.
 */

type TypeEvenement = Evenement['type'];
type PorteeEvenement = Evenement['portee'];

const LIBELLE_TYPE: Readonly<Record<TypeEvenement, string>> = {
  festival: 'Festival',
  ferie: 'Jour férié',
  sportif: 'Événement sportif',
  meteo_exceptionnelle: 'Météo exceptionnelle',
  greve: 'Grève',
  travaux: 'Travaux',
  concurrence: 'Concurrence',
  autre: 'Autre',
};

const LIBELLE_PORTEE: Readonly<Record<PorteeEvenement, string>> = {
  quartier: 'Quartier',
  liege: 'Liège',
  national: 'National',
};

/** Ordre de priorite pour porter le focus sur le premier champ en erreur (docs/07 §4.7). */
const ORDRE_CHAMPS = [
  'nom',
  'type',
  'dateDebut',
  'dateFin',
  'portee',
  'intensiteEstimee',
  'impactEstimeBp',
  'source',
  'notes',
  '_global',
] as const;

function focaliserPremierChampEnErreur(champs: ChampsEnErreur): void {
  for (const cle of ORDRE_CHAMPS) {
    if (cle in champs) {
      document.getElementById(cle)?.focus();
      return;
    }
  }
}

/** Multiplicateur lisible : 10000 bp -> « × 1,30 » (meme convention que ProchaineSession.tsx). */
function formaterFacteur(bp: number): string {
  return `× ${(bp / BASE_POINTS).toFixed(2).replace('.', ',')}`;
}

/** Lit un nombre en notation francaise (virgule ou point, signe optionnel). */
function nombreDepuisSaisie(saisie: string): number | null {
  const nettoye = saisie.trim().replace(',', '.');
  if (nettoye === '' || nettoye === '-' || nettoye === '+' || !/^[+-]?\d*\.?\d*$/.test(nettoye)) {
    return null;
  }
  const valeur = Number(nettoye);
  return Number.isFinite(valeur) ? valeur : null;
}

/** « 30 » (pour un ecart de +30 %) -> 13000 points de base. */
function bpDepuisEcartPourcent(saisie: string): number | null {
  const valeur = nombreDepuisSaisie(saisie);
  return valeur === null ? null : Math.round(BASE_POINTS + valeur * 100);
}

/** « 1,30 » -> 13000 points de base. */
function bpDepuisMultiplicateur(saisie: string): number | null {
  const valeur = nombreDepuisSaisie(saisie);
  return valeur === null ? null : Math.round(valeur * BASE_POINTS);
}

function libelleEvenements(nb: number): string {
  return `${nb} ${nb <= 1 ? 'événement' : 'événements'}`;
}

function formaterPeriode(dateDebut: string, dateFin: string): string {
  return dateDebut === dateFin
    ? formaterDate(dateDebut)
    : `${formaterDate(dateDebut)} – ${formaterDate(dateFin)}`;
}

const COLONNES: ReadonlyArray<ColonneTableau<Evenement>> = [
  {
    // `repli` : c'est la colonne IDENTIFIANTE de la rangée (pas d'autre
    // identifiant visible dans ce tableau) — docs/07 §4.5 l'interdit de
    // troncature par ellipse. MESURÉ le 31/07/2026 à 1280×720 : un nom réel
    // (« Marché de Noël du centre-ville de Liège ») a besoin de 258 px, la
    // colonne n'en donne que 184 — sans `repli`, huit caractères disparaissent
    // en silence derrière l'ellipse.
    cle: 'nom',
    libelle: 'Événement',
    largeur: '18%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (e) => e.nom,
    titre: (e) => e.nom,
  },
  {
    cle: 'type',
    libelle: 'Type',
    largeur: '10%',
    alignement: 'texte',
    // 10 % de large pour une enumeration : plusieurs libelles se reduisaient au
    // meme fragment. Le type conditionne le coefficient de prevision, on doit
    // pouvoir le lire.
    troncature: 'repli',
    rendu: (e) => LIBELLE_TYPE[e.type],
  },
  {
    // `repli` : une plage de dates est un identifiant qualitatif (docs/07
    // §4.5, « nombres qualitatifs — dates, numéros de lot ») — perdre son
    // dernier caractère (« 24/12/20… ») est pire qu'un texte tronqué, on ne
    // sait plus combien de chiffres ont disparu. MESURÉ : 166 px nécessaires
    // pour une plage sur deux mois, 143 px disponibles.
    cle: 'periode',
    libelle: 'Période',
    largeur: '14%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (e) => formaterPeriode(e.dateDebut, e.dateFin),
    titre: (e) => formaterPeriode(e.dateDebut, e.dateFin),
  },
  {
    cle: 'portee',
    libelle: 'Portée',
    largeur: '9%',
    alignement: 'texte',
    rendu: (e) => LIBELLE_PORTEE[e.portee],
  },
  {
    cle: 'intensite',
    libelle: 'Intensité',
    largeur: '10%',
    alignement: 'nombre',
    rendu: (e) => `${e.intensiteEstimee}/5`,
  },
  {
    cle: 'estime',
    libelle: 'Impact estimé',
    largeur: '14%',
    alignement: 'nombre',
    // Encre secondaire : c'est une INTUITION, jamais encore verifiee.
    rendu: (e) => <span className="text-ink-3">{formaterFacteur(e.impactEstimeBp)}</span>,
  },
  {
    cle: 'mesure',
    libelle: 'Impact mesuré',
    largeur: '14%',
    alignement: 'nombre',
    // Encre pleine : c'est une OBSERVATION, quand elle existe.
    rendu: (e) =>
      e.impactMesureBp === null ? (
        TIRET_ABSENT
      ) : (
        <span className="font-medium text-ink">{formaterFacteur(e.impactMesureBp)}</span>
      ),
  },
  {
    cle: 'statut',
    libelle: 'Statut',
    largeur: '11%',
    alignement: 'texte',
    // `repli` : MESURÉ, « Proposition IA — à valider » a besoin de 211 px,
    // la colonne n'en donne que 113 — sans repli, l'ellipse coupait
    // systématiquement après « Proposition IA », perdant le rappel d'action
    // « — à valider » sur CHAQUE proposition non encore traitée.
    troncature: 'repli',
    // Seule une proposition IA arrive non validee (docs/03) : un evenement
    // saisi a la main est valide d'office, sans ecran d'approbation dedie.
    rendu: (e) => (
      <span
        className={`inline-flex items-center gap-groupe font-medium ${
          e.valideParHumain ? 'text-conforme' : 'text-alerte'
        }`}
      >
        <span aria-hidden="true">{GLYPHE_STATUT[e.valideParHumain ? 'conforme' : 'alerte']}</span>
        {e.valideParHumain ? 'Validé' : 'Proposition IA — à valider'}
      </span>
    ),
  },
];

type EtatListe =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; evenements: Evenement[]; total: number };

export default function Evenements() {
  const navigate = useNavigate();
  const [etat, setEtat] = useState<EtatListe>({ statut: 'chargement' });
  /**
   * Le formulaire est ESCAMOTABLE, et fermé par défaut.
   *
   * En permanence ouvert, il volait 360 px à la table, qui tronquait alors ses
   * huit colonnes jusqu'à « Fete … » et « × … ». « La troncature est l'endroit
   * où les tableaux échouent discrètement » (docs/07 §4.5) : consulter est le
   * geste fréquent, saisir est le geste rare — c'est la consultation qui doit
   * avoir la largeur.
   */
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);

  /* Clavier (CLAUDE.md règle 10). Le formulaire est rendu APRÈS le tableau dans
     le DOM : sans rappel de focus, l'ouvrir obligeait à tabuler à travers toute
     la liste des événements pour atteindre le champ « Nom ». `Échap` le
     referme, comme le font `Achats.tsx` et `Production.tsx` pour leurs
     panneaux (docs/07 §4.6). */
  const boutonBascule = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (formulaireOuvert) document.getElementById('nom')?.focus();
  }, [formulaireOuvert]);

  useEffect(() => {
    if (!formulaireOuvert) return;
    function surAppuiTouche(evenement: KeyboardEvent): void {
      if (evenement.key !== 'Escape') return;
      setFormulaireOuvert(false);
      boutonBascule.current?.focus();
    }
    window.addEventListener('keydown', surAppuiTouche);
    return () => window.removeEventListener('keydown', surAppuiTouche);
  }, [formulaireOuvert]);

  const charger = useCallback(async () => {
    try {
      const brut = await requeteApi<unknown>('/evenements');
      const liste = schemaListeEvenements.parse(brut);
      setEtat({ statut: 'pret', evenements: liste.data, total: liste.meta.total });
    } catch (erreur) {
      setEtat({
        statut: 'erreur',
        message:
          erreur instanceof ErreurApi ? erreur.message : 'Erreur inattendue, sans plus de détail.',
      });
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  return (
    <div className="flex flex-col gap-bloc">
      <div className="flex h-barre items-center justify-between">
        <h1 className="text-lg text-ink">Événements</h1>
        <div className="flex items-center gap-groupe">
          <button
            type="button"
            onClick={() => navigate('/opportunites')}
            className="h-controle rounded-sm border border-line-field px-3 text-sm text-ink-2 hover:bg-surface-sunken"
          >
            Où aller ?
          </button>
          <button
            type="button"
            ref={boutonBascule}
            onClick={() => setFormulaireOuvert((ouvert) => !ouvert)}
            aria-expanded={formulaireOuvert}
            className={
              formulaireOuvert
                ? 'h-controle rounded-sm border border-line-field px-3 text-sm text-ink-2 hover:bg-surface-sunken'
                : 'h-controle rounded-sm bg-accent px-3 text-sm text-on-accent hover:bg-accent-hover'
            }
          >
            {formulaireOuvert ? 'Fermer le formulaire' : 'Nouvel événement'}
          </button>
        </div>
      </div>

      <p className="text-xs text-ink-3">
        Un événement ici module une session qui aurait eu lieu de toute façon (facteur classique).
        Un marché de Noël, un stand entreprise ou une fête médiévale sont des sessions qui
        n’existeraient PAS sans eux : ils se créent et se comparent dans « Où aller ? ».
      </p>

      {etat.statut === 'chargement' && (
        <p className="text-sm text-ink-3">Chargement des événements…</p>
      )}

      {etat.statut === 'erreur' && <MessageErreur message={etat.message} />}

      {etat.statut === 'pret' && (
        <div className="flex flex-col items-start gap-bloc lg:flex-row">
          <div className="min-w-0 flex-1 self-stretch">
            <Panneau titre={libelleEvenements(etat.total)} sansRembourrage>
              <Tableau
                colonnes={COLONNES}
                lignes={etat.evenements}
                cleLigne={(e) => e.id}
                etatVide={
                  <EtatVide
                    variante="premier-lancement"
                    titre="Aucun événement enregistré"
                    explication="Un festival, une braderie ou un jour férié modifie la fréquentation attendue : saisissez-le pour que la prévision en tienne compte."
                    action={{
                      libelle: 'Créer un événement',
                      onClick: () => setFormulaireOuvert(true),
                    }}
                  />
                }
              />
            </Panneau>
          </div>

          {formulaireOuvert && (
            <div className="w-full lg:w-[22.5rem] lg:shrink-0">
              {/* On ne referme PAS a la creation : le formulaire porte son propre
                  message de succes, et le masquer aussitot le rendrait invisible. */}
              <Panneau titre="Nouvel événement">
                <FormulaireEvenement onCree={() => void charger()} />
              </Panneau>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type Brouillon = {
  nom: string;
  type: TypeEvenement;
  dateDebut: string;
  dateFin: string;
  portee: PorteeEvenement;
  intensiteEstimee: string;
  modeImpact: 'ecart' | 'multiplicateur';
  valeurImpact: string;
  source: string;
  notes: string;
};

const BROUILLON_INITIAL: Brouillon = {
  nom: '',
  type: 'festival',
  dateDebut: '',
  dateFin: '',
  portee: 'quartier',
  intensiteEstimee: '3',
  modeImpact: 'ecart',
  valeurImpact: '',
  source: '',
  notes: '',
};

type EtatEnvoi =
  | { statut: 'inactif' }
  | { statut: 'envoi' }
  | { statut: 'succes' }
  | { statut: 'erreur'; message: string };

/** Effacement du message de succes (docs/07 §4.7 : succes 5 s, erreur persistante). */
const DELAI_SUCCES_MS = 5000;

const CLASSE_CHAMP_BASE =
  'w-full rounded-sm border border-line-field bg-surface px-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';
const CLASSE_CHAMP = `h-controle ${CLASSE_CHAMP_BASE}`;
const CLASSE_CHAMP_TEXTAREA = `${CLASSE_CHAMP_BASE} resize-none py-1`;

function FormulaireEvenement({ onCree }: { onCree: () => void }) {
  const [brouillon, setBrouillon] = useState<Brouillon>(BROUILLON_INITIAL);
  const [champs, setChamps] = useState<ChampsEnErreur>({});
  const [envoi, setEnvoi] = useState<EtatEnvoi>({ statut: 'inactif' });

  useEffect(() => {
    if (envoi.statut !== 'succes') return undefined;
    const minuteur = window.setTimeout(() => setEnvoi({ statut: 'inactif' }), DELAI_SUCCES_MS);
    return () => window.clearTimeout(minuteur);
  }, [envoi]);

  const bpCalcule =
    brouillon.modeImpact === 'ecart'
      ? bpDepuisEcartPourcent(brouillon.valeurImpact)
      : bpDepuisMultiplicateur(brouillon.valeurImpact);

  async function soumettre(evenement: FormEvent<HTMLFormElement>): Promise<void> {
    evenement.preventDefault();

    if (bpCalcule === null || bpCalcule <= 0) {
      setChamps({
        impactEstimeBp:
          bpCalcule === null
            ? 'Indiquez un nombre.'
            : 'L’effet doit rester positif : un écart ne peut pas descendre à −100 % ou moins.',
      });
      document.getElementById('impactEstimeBp')?.focus();
      return;
    }

    setChamps({});
    setEnvoi({ statut: 'envoi' });
    try {
      await requeteApi('/evenements', {
        method: 'POST',
        body: JSON.stringify({
          nom: brouillon.nom,
          type: brouillon.type,
          dateDebut: brouillon.dateDebut,
          dateFin: brouillon.dateFin,
          portee: brouillon.portee,
          intensiteEstimee: Number.parseInt(brouillon.intensiteEstimee, 10),
          impactEstimeBp: bpCalcule,
          source: brouillon.source.trim() === '' ? null : brouillon.source.trim(),
          notes: brouillon.notes.trim() === '' ? null : brouillon.notes.trim(),
        }),
      });
      setEnvoi({ statut: 'succes' });
      setBrouillon(BROUILLON_INITIAL);
      onCree();
      document.getElementById('nom')?.focus();
    } catch (erreur) {
      if (erreur instanceof ErreurApi && erreur.champs !== undefined) {
        setChamps(erreur.champs);
        focaliserPremierChampEnErreur(erreur.champs);
      }
      setEnvoi({
        statut: 'erreur',
        message: erreur instanceof ErreurApi ? erreur.message : 'La création a échoué.',
      });
    }
  }

  return (
    <form onSubmit={(e) => void soumettre(e)} className="flex flex-col gap-bloc">
      <EnveloppeChamp id="nom" label="Nom" erreur={champs.nom}>
        <input
          id="nom"
          type="text"
          required
          value={brouillon.nom}
          onChange={(e) => setBrouillon((b) => ({ ...b, nom: e.target.value }))}
          className={CLASSE_CHAMP}
        />
      </EnveloppeChamp>

      <EnveloppeChamp id="type" label="Type" erreur={champs.type}>
        <select
          id="type"
          value={brouillon.type}
          onChange={(e) => setBrouillon((b) => ({ ...b, type: e.target.value as TypeEvenement }))}
          className={CLASSE_CHAMP}
        >
          {Object.entries(LIBELLE_TYPE).map(([valeur, libelle]) => (
            <option key={valeur} value={valeur}>
              {libelle}
            </option>
          ))}
        </select>
      </EnveloppeChamp>

      <div className="grid grid-cols-2 gap-groupe">
        <EnveloppeChamp id="dateDebut" label="Début" erreur={champs.dateDebut}>
          <input
            id="dateDebut"
            type="date"
            required
            value={brouillon.dateDebut}
            onChange={(e) => setBrouillon((b) => ({ ...b, dateDebut: e.target.value }))}
            className={CLASSE_CHAMP}
          />
        </EnveloppeChamp>
        <EnveloppeChamp id="dateFin" label="Fin" erreur={champs.dateFin}>
          <input
            id="dateFin"
            type="date"
            required
            value={brouillon.dateFin}
            onChange={(e) => setBrouillon((b) => ({ ...b, dateFin: e.target.value }))}
            className={CLASSE_CHAMP}
          />
        </EnveloppeChamp>
      </div>

      <EnveloppeChamp id="portee" label="Portée" erreur={champs.portee}>
        <select
          id="portee"
          value={brouillon.portee}
          onChange={(e) =>
            setBrouillon((b) => ({ ...b, portee: e.target.value as PorteeEvenement }))
          }
          className={CLASSE_CHAMP}
        >
          {Object.entries(LIBELLE_PORTEE).map(([valeur, libelle]) => (
            <option key={valeur} value={valeur}>
              {libelle}
            </option>
          ))}
        </select>
      </EnveloppeChamp>

      <EnveloppeChamp
        id="intensiteEstimee"
        label="Intensité (1 à 5)"
        erreur={champs.intensiteEstimee}
      >
        <input
          id="intensiteEstimee"
          type="number"
          min={1}
          max={5}
          step={1}
          required
          value={brouillon.intensiteEstimee}
          onChange={(e) => setBrouillon((b) => ({ ...b, intensiteEstimee: e.target.value }))}
          className={CLASSE_CHAMP}
        />
      </EnveloppeChamp>

      <fieldset className="flex flex-col gap-groupe">
        <legend className="text-xs text-ink-3">Ampleur de l’effet attendu</legend>
        <div className="flex gap-bloc text-sm text-ink-2">
          <label className="inline-flex items-center gap-groupe">
            <input
              type="radio"
              name="mode-impact"
              checked={brouillon.modeImpact === 'ecart'}
              onChange={() => setBrouillon((b) => ({ ...b, modeImpact: 'ecart' }))}
            />
            Écart en %
          </label>
          <label className="inline-flex items-center gap-groupe">
            <input
              type="radio"
              name="mode-impact"
              checked={brouillon.modeImpact === 'multiplicateur'}
              onChange={() => setBrouillon((b) => ({ ...b, modeImpact: 'multiplicateur' }))}
            />
            Multiplicateur
          </label>
        </div>

        <EnveloppeChamp
          id="impactEstimeBp"
          label={brouillon.modeImpact === 'ecart' ? 'Écart attendu (%)' : 'Multiplicateur attendu'}
          erreur={champs.impactEstimeBp}
        >
          <input
            id="impactEstimeBp"
            type="text"
            inputMode="decimal"
            required
            placeholder={brouillon.modeImpact === 'ecart' ? 'ex. 30 pour +30 %' : 'ex. 1,30'}
            value={brouillon.valeurImpact}
            onChange={(e) => setBrouillon((b) => ({ ...b, valeurImpact: e.target.value }))}
            className={CLASSE_CHAMP}
          />
        </EnveloppeChamp>
        {champs.impactEstimeBp === undefined && (
          <p className="text-xs text-ink-3">
            {bpCalcule !== null && bpCalcule > 0
              ? `= ${formaterFacteur(bpCalcule)}`
              : 'La prévision multipliera sa base par ce facteur.'}
          </p>
        )}
      </fieldset>

      <EnveloppeChamp id="source" label="Source (optionnel)" erreur={champs.source}>
        <input
          id="source"
          type="text"
          value={brouillon.source}
          onChange={(e) => setBrouillon((b) => ({ ...b, source: e.target.value }))}
          className={CLASSE_CHAMP}
        />
      </EnveloppeChamp>

      <EnveloppeChamp id="notes" label="Notes (optionnel)" erreur={champs.notes}>
        <textarea
          id="notes"
          rows={2}
          value={brouillon.notes}
          onChange={(e) => setBrouillon((b) => ({ ...b, notes: e.target.value }))}
          className={CLASSE_CHAMP_TEXTAREA}
        />
      </EnveloppeChamp>

      {champs._global !== undefined && <p className="text-xs text-depassement">{champs._global}</p>}

      {envoi.statut === 'erreur' && (
        <p role="alert" className="text-sm text-depassement">
          {envoi.message}
        </p>
      )}
      {envoi.statut === 'succes' && (
        <p role="status" className="text-sm text-conforme">
          Événement créé et validé.
        </p>
      )}

      <button
        type="submit"
        disabled={envoi.statut === 'envoi'}
        className="h-controle w-full rounded-sm bg-accent text-sm text-on-accent hover:bg-accent-hover disabled:opacity-50"
      >
        {envoi.statut === 'envoi' ? 'Création…' : 'Créer l’événement'}
      </button>
    </form>
  );
}
