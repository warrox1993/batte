import { useCallback, useEffect, useState } from 'react';
import {
  formaterDate,
  formaterPourcent,
  formaterQuantite,
  GLYPHE_STATUT,
  schemaPrevisionCalendaire,
  type PrevisionCalendaire as PrevisionCalendaireDonnees,
  type SemaineCalendaire,
} from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { MessageErreur } from '../composants/EncartErreur';
import { ErreurApi, requeteApi } from '../lib/api';

/**
 * Ecran « Besoins projetés » — prévision calendaire et achats anticipés
 * (docs/demandes/06, docs/06-UI-ET-PARCOURS.md).
 *
 * Le piège central que cet écran doit éviter : une prévision à 300 jours n'a
 * pas la même valeur qu'une prévision à 7 jours. Chaque jour affiché porte
 * donc sa propre bande de confiance, et un jour dont l'intervalle P10/P90
 * est devenu trop large pour guider une décision affiche EXPLICITEMENT
 * « trop incertain » plutôt qu'un chiffre qui se déguiserait en prévision.
 *
 * `jour.exploitable === false` couvre en réalité DEUX causes distinctes,
 * confondues sous le même texte faute d'un champ dédié dans le contrat
 * (`schemaJourCalendaire`, `packages/core/src/contrats/previsions.ts`, hors
 * périmètre d'écriture) :
 *  1. l'intervalle P10/P90 est devenu trop large avec la distance calendaire
 *     (le piège ci-dessus) ;
 *  2. D-082 (`docs/05-DECISIONS.md`) : le LIEU de ce jour n'a encore AUCUNE
 *     session close — voir la documentation de `previsionPourDateCandidate`,
 *     `apps/api/src/routes/previsions.ts`, qui force `exploitable: false`
 *     dans ce cas précis, quelle que soit la largeur réelle de l'intervalle.
 * Le texte « trop incertain » reste VRAI dans les deux cas (aucun des deux
 * chiffres ne doit guider une décision), mais il ne dit pas LEQUEL s'applique
 * — limitation assumée, à lever seulement si un futur lot ajoute un champ qui
 * les distingue.
 *
 * Aucun calcul métier ici (CLAUDE.md §3 règle 1) : tout vient de
 * `/api/prevision-calendaire`.
 */

type EtatEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; prevision: PrevisionCalendaireDonnees };

/**
 * `jours: null` = « Horizon complet » : AUCUN paramètre `horizonJours` n'est
 * envoyé au serveur, qui applique alors son propre plafond
 * (`prevision_horizon_calendaire_jours`, `apps/api/src/routes/previsions.ts`
 * — `previsionCalendaireComplete` retombe sur `horizonMaxJours` dès que
 * `horizonDemandeJours` vaut `undefined`).
 *
 * AVANT ce correctif, cette option envoyait un `365` codé en dur — une valeur
 * PLAFONNÉE PARAMÉTRABLE (CLAUDE.md §7 : « ne pas coder en dur des… seuils »),
 * inoffensive tant que le paramètre reste à sa valeur par défaut (le serveur
 * l'écrête de toute façon à son propre plafond, `Math.min(…, horizonMaxJours)`),
 * mais silencieusement fausse le jour où quelqu'un RELÈVE ce plafond au-delà
 * de 365 jours : « Horizon complet » resterait alors borné à 365 sans qu'aucun
 * message ne le dise. Omettre le paramètre demande directement le plafond réel,
 * quel qu'il soit.
 */
const OPTIONS_HORIZON: ReadonlyArray<{ libelle: string; jours: number | null }> = [
  { libelle: '4 semaines', jours: 28 },
  { libelle: '12 semaines', jours: 84 },
  { libelle: 'Horizon complet', jours: null },
];

export default function PrevisionCalendaire() {
  const [etat, setEtat] = useState<EtatEcran>({ statut: 'chargement' });
  const [horizonJours, definirHorizonJours] = useState<number | null>(28);

  const charger = useCallback(async (jours: number | null) => {
    setEtat({ statut: 'chargement' });
    try {
      const chemin =
        jours === null ? '/prevision-calendaire' : `/prevision-calendaire?horizonJours=${jours}`;
      const brut = await requeteApi<unknown>(chemin);
      setEtat({ statut: 'pret', prevision: schemaPrevisionCalendaire.parse(brut) });
    } catch (erreur) {
      setEtat({
        statut: 'erreur',
        message:
          erreur instanceof ErreurApi
            ? erreur.message
            : 'La prévision calendaire n’a pas pu être calculée.',
      });
    }
  }, []);

  useEffect(() => {
    void charger(horizonJours);
  }, [charger, horizonJours]);

  return (
    <div className="flex flex-col gap-bloc">
      <div className="flex h-barre items-center justify-between">
        <h1 className="text-lg text-ink">Besoins projetés</h1>
        <div className="flex items-center gap-groupe">
          {OPTIONS_HORIZON.map((option) => (
            <button
              key={option.libelle}
              type="button"
              onClick={() => definirHorizonJours(option.jours)}
              className={
                'h-controle rounded-sm border px-3 text-sm ' +
                (option.jours === horizonJours
                  ? 'border-accent bg-accent text-on-accent'
                  : 'border-line-field text-ink-2 hover:bg-surface-sunken')
              }
            >
              {option.libelle}
            </button>
          ))}
        </div>
      </div>

      <p className="text-sm text-ink-3">
        Plus une date est lointaine, moins la météo, les événements et la tendance sont connus :
        l’incertitude affichée croît avec l’horizon, et un chiffre trop incertain pour guider une
        décision est annoncé comme tel plutôt qu’affiché avec le même aplomb qu’un chiffre à 7
        jours.
        {/*
          `horizonMaxJours` (`schemaPrevisionCalendaire`, calculé, testé, servi
          par `GET /prevision-calendaire`) était jamais lu par cet écran avant
          ce correctif (docs/21 §5, candidat non vérifié individuellement) :
          « Horizon complet » demandait un `365` codé en dur sans jamais dire
          ce que « complet » signifiait réellement. Affiché seulement une fois
          la prévision chargée : avant, on ne connaît pas encore le plafond
          paramétré côté serveur.
        */}
        {etat.statut === 'pret' && (
          <> « Horizon complet » couvre aujourd’hui jusqu’à J+{etat.prevision.horizonMaxJours}.</>
        )}
      </p>

      {etat.statut === 'chargement' && (
        <p className="text-sm text-ink-3">Calcul de la prévision calendaire…</p>
      )}

      {etat.statut === 'erreur' && <MessageErreur message={etat.message} />}

      {etat.statut === 'pret' && <Contenu prevision={etat.prevision} />}
    </div>
  );
}

type LigneAlerte = {
  cle: string;
  nomIngredient: string;
  unite: PrevisionCalendaireDonnees['alertesReapproPredictives'][number]['unite'];
  fenetreDebutJours: number;
  fenetreFinJours: number;
  declencheur: PrevisionCalendaireDonnees['alertesReapproPredictives'][number]['declencheur'];
  explication: string;
};

/**
 * Complète le texte d'explication d'une alerte de commande anticipée avec les
 * TROIS quantités qui la fondent.
 *
 * `besoinProjeteFenetre`, `stockProjeteActuel` et `deficit`
 * (`schemaAlerteReapproPredictive`, `packages/core/src/contrats/
 * previsions.ts:451-453`) sont calculés, testés, servis par
 * `GET /prevision-calendaire`, et n'étaient jamais lus par cet écran (audit
 * du 31/07/2026, docs/21 §5 — candidats non vérifiés individuellement par
 * l'audit, vérifiés ici) : seule la phrase QUALITATIVE (`explication`, qui
 * nomme le déclencheur — réactif, prédictif, ou les deux) était affichée,
 * jamais la MAGNITUDE du manque. Un « commandez maintenant » sans le chiffre
 * derrière ne dit pas COMBIEN commander.
 *
 * `joursExclusFenetre` n'est volontairement PAS répété ici : son
 * avertissement (« X jours de la fenêtre étaient trop incertains… ») est déjà
 * inclus mot pour mot dans `explication`
 * (`avertissementJoursExclus`/`explicationAlertePredictive`,
 * `apps/api/src/routes/previsions.ts`) — le redire ferait doublon.
 *
 * Un `deficit` à 0 sur une ligne déclenchée par le seul point de commande
 * RÉACTIF est un ZÉRO RÉEL (`deficit = max(0, besoin − stock)`,
 * `packages/core/src/prevision/point-commande-predictif.ts`), jamais une
 * inconnue déguisée : rien n'interdit de l'afficher tel quel (CLAUDE.md §7 ne
 * proscrit que le zéro qui maquille un `null`).
 */
export function phraseQuantitesAlerteReappro(alerte: {
  readonly explication: string;
  readonly besoinProjeteFenetre: number;
  readonly stockProjeteActuel: number;
  readonly deficit: number;
  readonly unite: PrevisionCalendaireDonnees['alertesReapproPredictives'][number]['unite'];
}): string {
  return (
    `${alerte.explication} Sur la fenêtre : besoin projeté ` +
    `${formaterQuantite(alerte.besoinProjeteFenetre, alerte.unite)}, stock projeté ` +
    `${formaterQuantite(alerte.stockProjeteActuel, alerte.unite)}, déficit ` +
    `${formaterQuantite(alerte.deficit, alerte.unite)}.`
  );
}

const LIBELLE_DECLENCHEUR: Record<LigneAlerte['declencheur'], string> = {
  les_deux: 'Réactif + prédictif',
  predictif: 'Prédictif',
  reactif: 'Réactif',
  aucun: 'Aucune',
};

const COLONNES_ALERTES: ReadonlyArray<ColonneTableau<LigneAlerte>> = [
  {
    cle: 'ingredient',
    libelle: 'Ingrédient',
    largeur: '26%',
    alignement: 'texte',
    rendu: (l) => l.nomIngredient,
    titre: (l) => l.nomIngredient,
  },
  {
    // Mesuré à 1280 px : 20 % coupait l'en-tête en « FENÊTRE DE COMMA… ».
    cle: 'fenetre',
    libelle: 'Fenêtre de commande',
    largeur: '22%',
    alignement: 'texte',
    rendu: (l) => `J+${l.fenetreDebutJours} à J+${l.fenetreFinJours}`,
  },
  {
    // Mesuré à 1280 px : 18 % coupait la valeur la plus longue,
    // « Réactif + prédictif », en « Réactif + prédi… ».
    cle: 'declencheur',
    libelle: 'Déclencheur',
    largeur: '23%',
    alignement: 'texte',
    rendu: (l) => (
      <span className={l.declencheur === 'aucun' ? 'text-ink-3' : 'text-alerte'}>
        {l.declencheur !== 'aucun' && `${GLYPHE_STATUT.alerte} `}
        {LIBELLE_DECLENCHEUR[l.declencheur]}
      </span>
    ),
    titre: (l) => LIBELLE_DECLENCHEUR[l.declencheur],
  },
  {
    cle: 'explication',
    libelle: 'Pourquoi',
    largeur: '29%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (l) => l.explication,
  },
];

type LigneBesoin = {
  cle: string;
  nomIngredient: string;
  unite: 'g' | 'ml' | 'piece';
  quantite: number;
};

const COLONNES_BESOINS: ReadonlyArray<ColonneTableau<LigneBesoin>> = [
  {
    cle: 'ingredient',
    libelle: 'Ingrédient',
    largeur: '65%',
    alignement: 'texte',
    rendu: (l) => l.nomIngredient,
  },
  {
    cle: 'quantite',
    libelle: 'Besoin projeté',
    largeur: '35%',
    alignement: 'nombre',
    rendu: (l) => <span className="tabular-nums">{formaterQuantite(l.quantite, l.unite)}</span>,
  },
];

function Contenu({ prevision }: { prevision: PrevisionCalendaireDonnees }) {
  const alertes: LigneAlerte[] = prevision.alertesReapproPredictives
    .filter((a) => a.declencheur !== 'aucun')
    .map((a) => ({
      cle: a.ingredientId,
      nomIngredient: a.nomIngredient,
      unite: a.unite,
      fenetreDebutJours: a.fenetreDebutJours,
      fenetreFinJours: a.fenetreFinJours,
      declencheur: a.declencheur,
      explication: phraseQuantitesAlerteReappro(a),
    }));

  return (
    <div className="flex flex-col gap-bloc">
      {prevision.repartitionRecettesIndisponible && (
        <div
          role="alert"
          className="border-l-2 border-depassement bg-depassement-bg px-3 py-2 text-sm text-depassement"
        >
          Plusieurs recettes actives coexistent sans historique de production pour les départager :
          le besoin en ingrédients ne peut pas être réparti entre elles pour l’instant. Il se
          calculera dès la première production enregistrée.
        </div>
      )}

      <Panneau
        titre="Commande anticipée — le plus contraignant des deux déclencheurs"
        sansRembourrage
      >
        <Tableau
          colonnes={COLONNES_ALERTES}
          lignes={alertes}
          cleLigne={(l) => l.cle}
          etatVide={
            <EtatVide
              variante="normal"
              texte="Aucune alerte de commande anticipée sur cet horizon."
            />
          }
        />
      </Panneau>

      {prevision.semaines.length === 0 ? (
        <EtatVide
          variante="premier-lancement"
          titre="Aucune session à venir"
          explication="Créez un lieu de marché avec un jour de semaine récurrent, ou planifiez une session, pour obtenir une prévision calendaire."
        />
      ) : (
        prevision.semaines.map((semaine) => (
          <SemainePanneau key={semaine.debutSemaine} semaine={semaine} />
        ))
      )}
    </div>
  );
}

/**
 * Exporté pour être testé directement (même convention que `ExplicationPrevision`
 * dans `ProchaineSession.tsx`) : c'est ici, et seulement ici, que le titre de
 * semaine décide de montrer ou non le total agrégé.
 */
export function SemainePanneau({ semaine }: { semaine: SemaineCalendaire }) {
  const besoins: LigneBesoin[] = semaine.besoinsIngredients.map((b) => ({
    cle: b.ingredientId,
    nomIngredient: b.nomIngredient,
    unite: b.unite,
    quantite: b.quantite,
  }));

  /*
   * `semaine.crepesPrevues` additionne les jours du groupe SANS distinguer
   * leur exploitabilité (le champ n'existe que par jour, `jour.exploitable`) :
   * dès qu'UN jour de la semaine est inexploitable, ce total peut inclure une
   * contribution que le moteur a lui-même déclarée sans valeur (voir le
   * rapport de livraison — le contrat documente un total restreint à la bande
   * fiable que le calcul ne restreint pas encore). Rien n'est recalculé ici
   * (CLAUDE.md §3 règle 1) : on lit seulement le verdict déjà transmis
   * jour par jour pour décider si ce total mérite de s'afficher comme un
   * chiffre solide, exact même principe que le `jour.exploitable ? … : …`
   * ci-dessous.
   */
  const tousLesJoursExploitables = semaine.jours.every((jour) => jour.exploitable);

  const titreSemaine = tousLesJoursExploitables
    ? `Semaine du ${formaterDate(semaine.debutSemaine)} au ${formaterDate(semaine.finSemaine)} — ${semaine.crepesPrevues} crêpes prévues`
    : `Semaine du ${formaterDate(semaine.debutSemaine)} au ${formaterDate(semaine.finSemaine)} — total trop incertain à cet horizon`;

  return (
    <div className="grid grid-cols-1 gap-bloc lg:grid-cols-2">
      <Panneau titre={titreSemaine}>
        <ul className="flex flex-col gap-groupe text-sm">
          {semaine.jours.map((jour) => (
            <li key={jour.dateSession} className="border-b border-line pb-groupe last:border-0">
              <div className="flex items-baseline justify-between">
                <span className="text-ink">
                  {formaterDate(jour.dateSession)} — {jour.lieuNom}
                  {jour.sessionId === null && (
                    <span className="ml-2 text-2xs uppercase text-ink-3">non créée</span>
                  )}
                </span>
                <span className="text-2xs uppercase text-ink-3">
                  {jour.bandeHorizon === 'fiable' ? 'Fiable' : 'Élargie'} —{' '}
                  {formaterPourcent(jour.confianceHorizonBp)}
                </span>
              </div>
              {jour.exploitable ? (
                <p className="tabular-nums text-ink-2">
                  {jour.crepesRecommandees} crêpes ({jour.p10} à {jour.p90})
                </p>
              ) : (
                <p className="italic text-ink-3">
                  Trop incertain à cet horizon pour guider une décision.
                </p>
              )}
              {jour.evenements.length > 0 && (
                <p className="text-xs text-ink-3">
                  Événement{jour.evenements.length > 1 ? 's' : ''} :{' '}
                  {jour.evenements.map((e) => e.nom).join(', ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Panneau>

      <Panneau titre="Besoins en ingrédients de la semaine" sansRembourrage>
        <Tableau
          colonnes={COLONNES_BESOINS}
          lignes={besoins}
          cleLigne={(l) => l.cle}
          etatVide={<EtatVide variante="normal" texte="Aucun besoin en ingrédients calculable." />}
        />
      </Panneau>
    </div>
  );
}
