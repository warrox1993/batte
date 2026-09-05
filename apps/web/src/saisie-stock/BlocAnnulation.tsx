import type { ReactNode, RefObject } from 'react';
import {
  CLASSE_BOUTON_LIEN,
  CLASSE_BOUTON_PRIMAIRE,
  CLASSE_BOUTON_SECONDAIRE,
  ChampSelection,
  type ErreursFormulaire,
} from './champs';
import { MessageErreur } from '../composants/EncartErreur';
import { OPTIONS_MOTIF_ANNULATION, type BlocageAnnulation } from './annulation';

/**
 * Bloc « annuler cette écriture », partagé par les deux capacités que D-087 a
 * trouvées complètes côté serveur et appelées par aucun écran : l'annulation
 * d'une RÉCEPTION (depuis `DetailLot.tsx`) et celle d'une PRODUCTION (depuis
 * `pages/Production.tsx`).
 *
 * ENTIÈREMENT PILOTÉ PAR SES PROPRIÉTÉS — il ne porte aucun état. Deux raisons,
 * et aucune n'est esthétique :
 *
 *  1. le FOCUS. D-079 (complément du 31/07/2026) : `disabled` posé sur un
 *     bouton qui a le focus le fait lâcher par le navigateur, avant tout rendu
 *     React. Où le focus revient ensuite dépend du GESTE, donc de l'écran —
 *     après une réception annulée, ce bloc lui-même n'affiche plus qu'une
 *     phrase de blocage (`blocageAnnulationReception`) : il ne reste ICI rien
 *     vers quoi revenir, que le lot survive dans la liste de `Stock.tsx`
 *     (corrigée le 31/07/2026, D-083) ou non ; après une production annulée,
 *     le panneau reste ET son propre bouton bascule survit. Enfermer cette
 *     décision ici la rendrait fausse pour l'un des deux. Les deux `ref` sont
 *     donc fournies par l'appelant ;
 *  2. le RENDU reste vérifiable sans navigateur (`BlocAnnulation.test.tsx`,
 *     `renderToStaticMarkup`) : chaque état s'obtient en passant des
 *     propriétés, sans avoir à simuler un clic — ce que le dépôt ne sait pas
 *     faire, faute de `jsdom` (CLAUDE.md §7).
 *
 * VOLONTAIREMENT PAS UN `<form>` : `Entrée` ne doit jamais pouvoir déclencher
 * une annulation par mégarde. Même précaution que la contrepassation et le
 * changement de statut de lot (`DetailLot.tsx`), et que « Lancer la
 * production ».
 */

export type BlocAnnulationProps = {
  /** Intitulé de la section, en petites capitales : « Réception d'origine ». */
  readonly titre: string;
  /** Ligne d'identité, toujours lisible : numéro lisible, date, nombre de lots. */
  readonly identite: ReactNode;
  /**
   * `null` quand l'annulation est possible — le bouton s'affiche. Sinon la
   * raison remplace le bouton : un bouton qui échoue toujours est le même
   * défaut que l'avertissement absent.
   */
  readonly blocage: BlocageAnnulation;
  readonly ouvert: boolean;
  readonly onOuvrir: () => void;
  readonly onFermer: () => void;
  readonly libelleOuverture: string;
  /** Conséquence exacte du geste, lue AVANT la confirmation. */
  readonly phraseAvant: string;
  readonly libelleConfirmation: string;
  /**
   * Nom HTML du champ motif — unique par écran, deux blocs pouvant coexister
   * dans le même document. N'est PAS la clé d'erreur : le serveur signale un
   * motif refusé sous `champs.motifCode` (`resoudreCodeMotif`,
   * `apps/api/src/routes/stock.ts`), quel que soit le nom du contrôle. Les
   * confondre faisait disparaître le message en silence — exactement l'échec
   * silencieux que CLAUDE.md §4 interdit, et ce que le test de rendu a
   * attrapé.
   */
  readonly nomChampMotif: string;
  readonly motif: string;
  readonly onMotifChange: (valeur: string) => void;
  readonly erreurs: ErreursFormulaire;
  readonly enCours: boolean;
  readonly onConfirmer: () => void;
  readonly refOuvrir?: RefObject<HTMLButtonElement | null>;
  readonly refConfirmer?: RefObject<HTMLButtonElement | null>;
};

export function BlocAnnulation({
  titre,
  identite,
  blocage,
  ouvert,
  onOuvrir,
  onFermer,
  libelleOuverture,
  phraseAvant,
  libelleConfirmation,
  nomChampMotif,
  motif,
  onMotifChange,
  erreurs,
  enCours,
  onConfirmer,
  refOuvrir,
  refConfirmer,
}: BlocAnnulationProps) {
  return (
    <div className="border-b border-line px-4 py-2">
      <h3 className="text-2xs uppercase text-ink-3">{titre}</h3>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-groupe">
        <p className="text-sm text-ink-2">{identite}</p>
        {blocage === null && !ouvert && (
          <button
            type="button"
            {...(refOuvrir !== undefined ? { ref: refOuvrir } : {})}
            onClick={onOuvrir}
            className={`text-xs ${CLASSE_BOUTON_LIEN}`}
          >
            {libelleOuverture}
          </button>
        )}
      </div>

      {/* La raison prend la place du bouton, jamais les deux : « le refus doit
          être dit avant, pas découvert en cliquant ». */}
      {blocage !== null && <p className="mt-groupe text-xs text-ink-3">{blocage.raison}</p>}

      {ouvert && (
        <div className="mt-2 flex flex-col gap-groupe border-t border-line-strong pt-2">
          <p className="text-xs text-ink-2">{phraseAvant}</p>

          <div className="grid grid-cols-1 items-start gap-groupe lg:grid-cols-2">
            <ChampSelection
              nom={nomChampMotif}
              libelle="Motif de l'annulation"
              valeur={motif}
              onChange={onMotifChange}
              options={OPTIONS_MOTIF_ANNULATION}
              optionVide="Choisir…"
              obligatoire
              erreur={erreurs.champs['motifCode']}
              aide="Choisi dans la liste, jamais tapé : c'est lui qui reste au journal d'audit."
            />
          </div>

          {erreurs.general !== null && <MessageErreur message={erreurs.general} />}

          <div className="flex items-center justify-end gap-groupe">
            {/* « Fermer » et non « Annuler » : à côté d'« Annuler la
                réception », le second sens du mot rendrait le bouton
                ambigu au moment précis où il ne doit pas l'être. */}
            <button type="button" onClick={onFermer} className={CLASSE_BOUTON_SECONDAIRE}>
              Fermer
            </button>
            <button
              type="button"
              {...(refConfirmer !== undefined ? { ref: refConfirmer } : {})}
              onClick={onConfirmer}
              disabled={enCours}
              className={CLASSE_BOUTON_PRIMAIRE}
            >
              {enCours ? 'Annulation…' : libelleConfirmation}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
