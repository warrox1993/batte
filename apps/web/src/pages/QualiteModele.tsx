import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TIRET_ABSENT,
  formaterDate,
  formaterEuros,
  formaterPourcent,
  ouTiret,
  schemaListePrevisions,
  schemaQualiteModele,
  type PredicteursPrecision,
  type PrevisionArchivee,
  type QualiteModele as DonneesQualiteModele,
  type SyntheseManqueAGagner,
} from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { MessageErreur } from '../composants/EncartErreur';
import { ErreurApi, requeteApi } from '../lib/api';

/**
 * Ecran Qualite du modele (docs/03 « Mesure de la qualite du modele », docs/06,
 * docs/07). Aucun calcul metier ici (CLAUDE.md §3 regle 1) : les quatre
 * indicateurs et l'historique viennent tels quels de `/api/qualite-modele` et
 * `/api/previsions`.
 *
 * Le taux de couverture est LE chiffre honnete de cet ecran : un intervalle
 * P10–P90 juste doit contenir le realise ~80 % du temps. C'est le seul
 * `text-3xl` de la page. Tant qu'aucune prevision n'a ete rapprochee d'une
 * session reellement realisee, afficher un pourcentage serait un mensonge —
 * on le dit franchement plutot que d'afficher « 0 % d'erreur ».
 */

// Signe moins typographique U+2212, en sequence d'echappement (docs/07 §4.5 :
// un caractere invisible en litteral est impossible a relire).
const MOINS = '\u2212';

/** Signe systematique (docs/07 §4.5) : un biais nul, positif ou negatif ne s'ecrivent jamais pareil. */
function formaterEcartCrepes(valeur: number): string {
  if (valeur === 0) return '0 crêpe';
  const grandeur = Math.abs(valeur);
  const signe = valeur < 0 ? MOINS : '+';
  return `${signe}${grandeur} crêpe${grandeur > 1 ? 's' : ''}`;
}

function interpreterBiais(valeur: number): string {
  if (valeur === 0) return 'Aucune tendance à sur- ou sous-estimer ne se dégage.';
  return valeur > 0
    ? 'Le modèle a tendance à sous-estimer la demande.'
    : 'Le modèle a tendance à sur-estimer la demande.';
}

/** Identifie une ligne d'historique par sa session, ou par sa date de calcul si elle n'en a pas. */
function libelleSession(p: PrevisionArchivee): string {
  return p.sessionNumero !== null && p.dateSession !== null
    ? `${p.sessionNumero} · ${formaterDate(p.dateSession)}`
    : `Sans session · ${formaterDate(p.dateCalcul)}`;
}

/**
 * Infobulle de la colonne « Session » : commence par le texte réellement
 * rendu (même convention que `titreEcoulement`, `packages/core/src/
 * affichage.ts`), puis nomme la génération d'algorithme qui a produit cette
 * ligne.
 *
 * `versionModele` (`schemaPrevisionArchivee`, `packages/core/src/contrats/
 * previsions.ts:209`) était calculé, testé, servi par `GET /previsions`, et
 * jamais lu par cet écran (audit du 31/07/2026). Son commentaire de schéma :
 * « Identifie la génération d'algorithme, pour comparer des pommes et des
 * pommes ». Sans lui, une ligne dont l'erreur diverge après un changement de
 * moteur de prévision se lit comme une anomalie plutôt que comme un effet de
 * version — exactement le risque qu'il existe pour signaler.
 */
export function titreSessionAvecModele(p: PrevisionArchivee): string {
  return `${libelleSession(p)} — modèle ${p.versionModele}`;
}

const COLONNES: ReadonlyArray<ColonneTableau<PrevisionArchivee>> = [
  {
    cle: 'session',
    libelle: 'Session',
    largeur: '28%',
    alignement: 'texte',
    // « Sans session · 27/07/2026 » et « S-2026-014 · 27/07/2026 » ne different
    // que par la date une fois tronques : c'est la colonne qui identifie la
    // ligne, elle ne peut pas etre coupee.
    troncature: 'repli',
    rendu: libelleSession,
    titre: titreSessionAvecModele,
  },
  {
    cle: 'prevu',
    libelle: 'Prévu (crêpes)',
    largeur: '12%',
    alignement: 'nombre',
    rendu: (p) => String(p.p50Crepes),
  },
  {
    cle: 'recommande',
    libelle: 'Recommandé',
    largeur: '12%',
    alignement: 'nombre',
    rendu: (p) => String(p.crepesRecommandees),
  },
  {
    cle: 'retenu',
    libelle: 'Retenu',
    largeur: '12%',
    alignement: 'nombre',
    rendu: (p) => String(p.crepesRetenues),
  },
  {
    cle: 'realise',
    libelle: 'Réalisé',
    largeur: '12%',
    alignement: 'nombre',
    rendu: (p) => ouTiret(p.crepesReelles, (v) => String(v)),
  },
  {
    cle: 'erreur',
    libelle: 'Erreur',
    largeur: '12%',
    alignement: 'nombre',
    rendu: (p) => ouTiret(p.erreurAbsolueBp, (v) => formaterPourcent(v)),
  },
  {
    cle: 'confiance',
    libelle: 'Confiance',
    largeur: '12%',
    alignement: 'nombre',
    rendu: (p) => formaterPourcent(p.confianceBp),
  },
];

type EtatEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | {
      statut: 'pret';
      qualite: DonneesQualiteModele;
      previsions: PrevisionArchivee[];
      total: number;
    };

export default function QualiteModele() {
  const navigate = useNavigate();
  const [etat, setEtat] = useState<EtatEcran>({ statut: 'chargement' });

  useEffect(() => {
    let annule = false;

    Promise.all([requeteApi<unknown>('/qualite-modele'), requeteApi<unknown>('/previsions')])
      .then(([brutQualite, brutPrevisions]) => {
        if (annule) return;
        const qualite = schemaQualiteModele.parse(brutQualite);
        const previsions = schemaListePrevisions.parse(brutPrevisions);
        setEtat({
          statut: 'pret',
          qualite,
          previsions: previsions.data,
          total: previsions.meta.total,
        });
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

  return (
    <div className="flex flex-col gap-bloc">
      <h1 className="flex h-rangee items-center text-lg text-ink">Qualité du modèle</h1>

      {etat.statut === 'chargement' && (
        <p className="text-sm text-ink-3">Chargement des indicateurs…</p>
      )}

      {etat.statut === 'erreur' && <MessageErreur message={etat.message} />}

      {etat.statut === 'pret' && (
        <Contenu
          qualite={etat.qualite}
          previsions={etat.previsions}
          total={etat.total}
          onAllerProchaineSession={() => navigate('/prochaine-session')}
        />
      )}
    </div>
  );
}

function Contenu({
  qualite,
  previsions,
  total,
  onAllerProchaineSession,
}: {
  qualite: DonneesQualiteModele;
  previsions: PrevisionArchivee[];
  total: number;
  onAllerProchaineSession: () => void;
}) {
  // Rien n'a encore ete archive : c'est le seul cas ou l'ecran entier se
  // resume a un etat vide, action a l'appui (docs/07 §4.7).
  if (total === 0) {
    return (
      <EtatVide
        variante="premier-lancement"
        titre="Aucune prévision archivée"
        explication="La qualité du modèle se mesure en comparant chaque prévision archivée au nombre de crêpes réellement vendu. Archivez une première prévision depuis « Prochaine session » pour commencer."
        action={{ libelle: 'Aller à Prochaine session', onClick: onAllerProchaineSession }}
      />
    );
  }

  const rapproche = qualite.nbPrevisionsRapprochees > 0;

  return (
    <>
      <Panneau titre="Indicateurs de qualité">
        {rapproche ? (
          <>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl tabular-nums text-ink">
                {ouTiret(qualite.tauxCouvertureBp, (v) => formaterPourcent(v))}
              </span>
              <span className="text-sm text-ink-3">de couverture de la fourchette P10–P90</span>
            </div>
            <p className="mt-groupe text-sm text-ink-2">
              Sur {qualite.nbPrevisionsRapprochees} prévision
              {qualite.nbPrevisionsRapprochees > 1 ? 's' : ''} comparée
              {qualite.nbPrevisionsRapprochees > 1 ? 's' : ''} au réalisé, le nombre de crêpes vendu
              est tombé dans la fourchette annoncée dans cette proportion des cas. Une fourchette
              bien calée devrait l’englober environ 8 fois sur 10 : beaucoup plus, elle est trop
              large pour aider à décider ; beaucoup moins, elle promet une précision qu’elle n’a
              pas.
            </p>

            <dl className="mt-bloc grid grid-cols-2 gap-groupe border-t border-line pt-bloc text-sm lg:grid-cols-3">
              <div>
                <dt className="text-2xs uppercase text-ink-3">Prévisions rapprochées</dt>
                <dd className="tabular-nums text-ink-2">{qualite.nbPrevisionsRapprochees}</dd>
              </div>
              <div>
                <dt className="text-2xs uppercase text-ink-3">Erreur moyenne</dt>
                <dd className="tabular-nums text-ink-2">
                  {ouTiret(qualite.erreurMoyenneBp, (v) => formaterPourcent(v))}
                </dd>
              </div>
              <div>
                <dt className="text-2xs uppercase text-ink-3">Biais moyen</dt>
                <dd className="tabular-nums text-ink-2">
                  {qualite.biaisMoyenCrepes === null
                    ? TIRET_ABSENT
                    : formaterEcartCrepes(qualite.biaisMoyenCrepes)}
                </dd>
              </div>
              {/*
               * Trois indicateurs de docs/03 « Mesure de la qualité du modèle »,
               * manquants avant docs/17 fiche 8 : MAPE glissante sur les 10
               * dernières sessions, taux de rupture, taux d'invendu. Portent sur
               * la production RÉELLE des sessions, pas seulement sur les lignes
               * de prévision rapprochées ci-dessus — voir `npm run backtest`
               * pour un rejeu complet, hors échantillon, de l'historique.
               */}
              <div>
                <dt className="text-2xs uppercase text-ink-3">
                  MAPE glissante ({qualite.nbSessionsMapeGlissante} session
                  {qualite.nbSessionsMapeGlissante > 1 ? 's' : ''})
                </dt>
                <dd className="tabular-nums text-ink-2">
                  {ouTiret(qualite.mapeGlissanteBp, (v) => formaterPourcent(v))}
                </dd>
              </div>
              <div>
                <dt className="text-2xs uppercase text-ink-3">
                  Taux de rupture ({qualite.nbSessionsEcoulement} session
                  {qualite.nbSessionsEcoulement > 1 ? 's' : ''})
                </dt>
                <dd className="tabular-nums text-ink-2">
                  {ouTiret(qualite.tauxRuptureBp, (v) => formaterPourcent(v))}
                </dd>
              </div>
              <div>
                <dt className="text-2xs uppercase text-ink-3">
                  Taux d’invendu ({qualite.nbSessionsEcoulement} session
                  {qualite.nbSessionsEcoulement > 1 ? 's' : ''})
                </dt>
                <dd className="tabular-nums text-ink-2">
                  {ouTiret(qualite.tauxInvenduBp, (v) => formaterPourcent(v))}
                </dd>
              </div>
            </dl>
            {qualite.biaisMoyenCrepes !== null && (
              <p className="mt-groupe text-xs text-ink-3">
                {interpreterBiais(qualite.biaisMoyenCrepes)}
              </p>
            )}
          </>
        ) : (
          // Des previsions sont archivees, mais aucune n'a encore ete rapprochee
          // d'une session realisee : les indicateurs ne sont pas calculables.
          // Jamais « 0 % d'erreur » — ce serait un mensonge (consigne du lot).
          <p className="text-sm text-ink-2">
            Aucune des {total} prévision{total > 1 ? 's' : ''} archivée{total > 1 ? 's' : ''} n’a
            encore été rapprochée d’une session dont le réalisé a été saisi. Les indicateurs
            apparaîtront après la clôture de la première session concernée.
          </p>
        )}
      </Panneau>

      <PanneauManqueAGagner synthese={qualite.syntheseManqueAGagner} />

      <PanneauPredicteursPrecision predicteurs={qualite.predicteursPrecision} />

      <Panneau
        titre={`Historique — ${total} prévision${total > 1 ? 's' : ''} archivée${total > 1 ? 's' : ''}`}
        sansRembourrage
      >
        <Tableau
          colonnes={COLONNES}
          lignes={previsions}
          cleLigne={(p) => p.id}
          etatVide={
            <EtatVide
              variante="premier-lancement"
              titre="Aucune prévision archivée"
              explication="Archivez une prévision depuis « Prochaine session » pour commencer à suivre la qualité du modèle dans le temps."
              action={{ libelle: 'Aller à Prochaine session', onClick: onAllerProchaineSession }}
            />
          }
        />
      </Panneau>
    </>
  );
}

/**
 * Manque à gagner cumulé + contrainte limitante la plus fréquente
 * (`prevision.manqueAGagnerCents` / `prevision.contrainteLimitante`, audit du
 * 30/07/2026 — `docs/13-AUDIT-CAPACITES-ORPHELINES.md` et
 * `audit-colonnes-orphelines.test.ts`) : archivées à chaque prévision,
 * jamais relues avant ce lot.
 *
 * C'est la réponse chiffrée à « combien le fait de ne pas pouvoir produire
 * plus a-t-il coûté ? » (docs/03 « Décision de production ») — le chiffre qui
 * justifierait, preuves à l'appui, un investissement futur (troisième
 * plaque, camionnette). Rendu ici, PAS sur « Prochaine session » : cet
 * écran-ci est celui qui lit l'historique archivé, l'autre ne montre que le
 * calcul EN COURS (homonyme `contrainteLimitante` calculé en direct — voir
 * l'audit, ne pas confondre les deux).
 *
 * Aucun panneau dans un panneau (docs/07 §4.8) : un `<Panneau>` de plus,
 * jamais imbriqué dans celui des indicateurs.
 */
function PanneauManqueAGagner({ synthese }: { synthese: SyntheseManqueAGagner }) {
  return (
    <Panneau titre="Manque à gagner — contrainte de production">
      <div className="flex items-baseline gap-3">
        <span className="text-3xl tabular-nums text-ink">
          {ouTiret(synthese.totalCents, formaterEuros)}
        </span>
        <span className="text-sm text-ink-3">
          de manque à gagner cumulé, sur {synthese.nbPrevisionsChiffrees} prévision
          {synthese.nbPrevisionsChiffrees > 1 ? 's' : ''} où une contrainte de production a bridé la
          quantité retenue (sur {synthese.nbPrevisionsTotal} archivée
          {synthese.nbPrevisionsTotal > 1 ? 's' : ''} au total).
        </span>
      </div>
      <p className="mt-groupe text-sm text-ink-2">
        {synthese.nbPrevisionsChiffrees === 0
          ? 'Aucune prévision archivée n’a encore été limitée par une contrainte de production ' +
            '(capacité de cuisson, glacière, stock d’ingrédients, volume transportable).'
          : 'C’est ce total, cumulé sur l’historique, qui justifierait un jour un investissement ' +
            '(troisième plaque, camionnette) — voir docs/03 « Décision de production ».'}
      </p>
      {synthese.contrainteLaPlusFrequente !== null && (
        <p className="mt-groupe text-xs text-ink-3">
          Contrainte la plus fréquente : {synthese.contrainteLaPlusFrequente} (
          {synthese.nbPrevisionsContrainteLaPlusFrequente} prévision
          {synthese.nbPrevisionsContrainteLaPlusFrequente > 1 ? 's' : ''}).
        </p>
      )}
    </Panneau>
  );
}

/** Une ligne de `PanneauPredicteursPrecision` : libellé lisible + compteur d'activation. */
function LignePredicteur({
  libelle,
  compte,
}: {
  libelle: string;
  compte: { nbActif: number; nbTotal: number };
}) {
  return (
    <div>
      <dt className="text-2xs uppercase text-ink-3">{libelle}</dt>
      <dd className="tabular-nums text-ink-2">
        {compte.nbActif} / {compte.nbTotal}
      </dd>
    </div>
  );
}

/**
 * Activation des quatre "facteurs de précision" de la fiche 07
 * (`docs/demandes/07-HISTORIQUE-VENTES-RETENTION-ET-PRECISION.md` §2) sur
 * l'historique archivé — audit du 30/07/2026 : écrits à chaque prévision,
 * jamais relus avant ce lot.
 *
 * « X / Y » compte les prévisions où le prédicteur a été ADMIS (validation
 * croisée leave-one-out réussie), pas son effet mesuré — un prédicteur
 * neutre (× 1,00) reste ACTIF s'il a été retenu.
 */
function PanneauPredicteursPrecision({ predicteurs }: { predicteurs: PredicteursPrecision }) {
  return (
    <Panneau titre="Précision des prédicteurs (fiche 07)">
      <p className="text-sm text-ink-2">
        Quatre facteurs affinent la prévision de base quand l’historique le permet ; chacun n’entre
        en jeu qu’après avoir battu son absence en validation croisée. Le compte ci-dessous est le
        nombre de prévisions archivées où le facteur a été retenu, sur le total archivé.
      </p>
      <dl className="mt-bloc grid grid-cols-2 gap-groupe border-t border-line pt-bloc text-sm lg:grid-cols-4">
        <LignePredicteur
          libelle="Comparable calendaire"
          compte={predicteurs.facteurComparableCalendaireBp}
        />
        <LignePredicteur libelle="Jour de semaine" compte={predicteurs.facteurJourSemaineBp} />
        <LignePredicteur
          libelle="Vacances scolaires"
          compte={predicteurs.facteurVacancesScolairesBp}
        />
        <LignePredicteur
          libelle="Session consécutive"
          compte={predicteurs.facteurSessionConsecutiveBp}
        />
      </dl>
    </Panneau>
  );
}
