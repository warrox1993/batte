import { useRef, useState } from 'react';
import { schemaCommentaireIa, type CommentaireIa } from '@batte/core';
import { ErreurApi } from '../lib/api';

type EtatDemande =
  | { statut: 'inactif' }
  | { statut: 'en_cours' }
  | { statut: 'recu'; commentaire: CommentaireIa }
  | { statut: 'erreur'; message: string };

/**
 * Un bouton qui demande un commentaire à Claude, puis affiche la réponse.
 *
 * Partagé par « Avis de Claude » et « Résumé du brief » (`ProchaineSession.tsx`)
 * et par l'analyse d'écart d'une session close (`Sessions.tsx`), qui portaient
 * chacun leur copie du même défaut de clavier (CLAUDE.md §3 règle 10), corrigé
 * ici une seule fois le 28/09/2026 :
 *
 *  - PENDANT l'appel, le bouton était démonté (remplacé par « Claude
 *    réfléchit… »), et le focus retombait sur `<body>`. Il reste désormais
 *    rendu, inerte (`aria-disabled`), avec un libellé d'attente : le focus ne
 *    bouge pas.
 *  - `aria-disabled` n'empêche aucun clic : `demander()` refuse donc elle-même
 *    un second départ tant que le premier est en vol (un appel Claude coûte).
 *  - APRÈS la réponse, le bouton disparaît au profit du résultat. Si c'est lui
 *    qui avait le focus, le focus passe au résultat (`tabIndex={-1}`), qui
 *    prend sa place, au lieu de retomber sur `<body>`.
 */
export function DemandeClaude({
  presentation,
  libelleBouton,
  appeler,
  messageEchec,
  formaterCout,
  raisonIndisponible,
}: {
  /** Phrase affichée à côté du bouton tant que rien n'a été demandé. */
  readonly presentation: string;
  readonly libelleBouton: string;
  /** L'appel réseau ; sa réponse brute est validée par `schemaCommentaireIa`. */
  readonly appeler: () => Promise<unknown>;
  /** Message affiché si l'échec n'est pas une `ErreurApi` explicite. */
  readonly messageEchec: string;
  readonly formaterCout: (coutCents: number) => string;
  /** Si défini, l'assistance est indisponible : le bouton est inerte et le dit. */
  readonly raisonIndisponible?: string | undefined;
}) {
  const [etat, setEtat] = useState<EtatDemande>({ statut: 'inactif' });
  const boutonRef = useRef<HTMLButtonElement>(null);
  const resultatRef = useRef<HTMLDivElement>(null);

  const inerte = etat.statut === 'en_cours' || raisonIndisponible !== undefined;

  const demander = async (): Promise<void> => {
    if (inerte) return;
    setEtat({ statut: 'en_cours' });
    let suivant: EtatDemande;
    try {
      const brut = await appeler();
      suivant = { statut: 'recu', commentaire: schemaCommentaireIa.parse(brut) };
    } catch (erreur) {
      suivant = {
        statut: 'erreur',
        message: erreur instanceof ErreurApi ? erreur.message : messageEchec,
      };
    }
    // Lu AVANT le rendu qui démonte le bouton : après, le focus serait déjà
    // sur `<body>` et on ne saurait plus s'il était sur le bouton.
    const boutonAvaitLeFocus = document.activeElement === boutonRef.current;
    setEtat(suivant);
    if (boutonAvaitLeFocus) requestAnimationFrame(() => resultatRef.current?.focus());
  };

  if (etat.statut === 'inactif' || etat.statut === 'en_cours') {
    return (
      <div className="flex items-center justify-between gap-bloc">
        <p className="text-sm text-ink-3">{raisonIndisponible ?? presentation}</p>
        <button
          ref={boutonRef}
          type="button"
          onClick={() => void demander()}
          aria-disabled={inerte}
          {...(raisonIndisponible !== undefined ? { title: raisonIndisponible } : {})}
          className={`h-controle shrink-0 rounded-sm border border-line-field px-3 text-sm text-ink-2 hover:bg-surface-sunken ${
            inerte ? 'cursor-not-allowed opacity-60' : ''
          }`}
        >
          {etat.statut === 'en_cours' ? 'Claude réfléchit…' : libelleBouton}
        </button>
      </div>
    );
  }

  return (
    <div ref={resultatRef} tabIndex={-1} className="flex flex-col gap-groupe outline-none">
      {etat.statut === 'recu' && etat.commentaire.disponible && (
        <>
          <div className="whitespace-pre-wrap text-sm text-ink-2">{etat.commentaire.texte}</div>
          <p className="text-xs text-ink-3">{formaterCout(etat.commentaire.coutCents)}</p>
        </>
      )}
      {etat.statut === 'recu' && !etat.commentaire.disponible && (
        <p className="text-sm text-ink-3">{etat.commentaire.raison}</p>
      )}
      {etat.statut === 'erreur' && <p className="text-sm text-depassement">{etat.message}</p>}
    </div>
  );
}
