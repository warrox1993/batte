import { useEffect, useState } from 'react';
import {
  TIRET_ABSENT,
  formaterDateHeure,
  formaterEuros,
  formaterMontant,
  ouTiret,
  schemaEtatIa,
  schemaJournalIa,
  type AppelIa,
  type EtatIa,
} from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { MessageErreur } from '../composants/EncartErreur';
import { ErreurApi, requeteApi } from '../lib/api';

/**
 * Écran « Assistance IA » — groupe CONTRÔLE de la navigation (audit du
 * 30/07/2026, mission dédiée au garde-fou de dépense de CLAUDE.md §5).
 *
 * POURQUOI CET ÉCRAN. §5 impose trois garde-fous pour l'usage de l'API
 * Claude : un compteur de coût par appel (`journal_ia`), un plafond mensuel
 * qui coupe les appels non essentiels, et un mode dégradé complet. Les trois
 * sont construits côté serveur — `GET /api/ia/etat`
 * (`apps/api/src/routes/ia.ts:39`) et `GET /api/ia/journal` (`ia.ts:61`) —
 * mais n'étaient consommés par AUCUN écran (`docs/13-AUDIT-CAPACITES-
 * ORPHELINES.md` §4.6, confirmé le 30/07/2026 par un grep sans résultat sur
 * `ia/etat` et `ia/journal` dans `apps/web/src`). Le porteur payait l'API à
 * l'usage sans pouvoir consulter ni son plafond, ni sa consommation, ni le
 * coût d'un appel passé. Un plafond qu'on découvre au moment où il coupe n'a
 * servi à rien.
 *
 * POURQUOI SÉPARÉ DE `ProchaineSession`. Deux besoins différents (CLAUDE.md
 * §0 : « chaque écran fait une chose »).
 *
 *  - Le COÛT D'UN APPEL se lit au moment où on le déclenche — c'est ce qui
 *    construit l'intuition (« ce brief m'a coûté deux centimes »). Affiché
 *    directement sur `ProchaineSession.tsx`, à côté du bouton « Demander un
 *    avis » (voir `formaterCoutAppelIa` dans ce fichier).
 *  - L'ÉTAT DU BUDGET se consulte quand on se pose la question, en dehors de
 *    tout geste de travail avant/après-marché : ça n'a pas sa place sur un
 *    écran de travail. D'où cet écran séparé, dans le groupe CONTRÔLE, aux
 *    côtés de Comptabilité, du Registre AFSCA et du Journal d'audit — la même
 *    famille de « prouve-le », consultée rarement mais trouvable.
 *
 * MODE DÉGRADÉ. `GET /api/ia/etat` rend TOUJOURS 200, y compris sans clé
 * configurée (`configuree: false` est un ÉTAT DU PRODUIT, pas une panne —
 * `ia.ts:1-9`) : cet écran ne peut donc pas confondre « assistance non
 * configurée » avec une erreur réseau. Seule une vraie panne (serveur non
 * démarré) bascule dans l'état `erreur` ci-dessous.
 *
 * CE QUE CET ÉCRAN NE FAIT PAS. Aucun calcul métier (CLAUDE.md §3 règle 1) :
 * le plafond, la dépense du mois et le reste viennent tels quels de
 * `/ia/etat`. La seule logique d'ici est une DÉCISION D'AFFICHAGE —
 * `resumerBudgetIa` — qui ne recalcule rien, elle choisit quelle phrase
 * montrer, notamment pour ne jamais confondre « aucun appel journalisé » et
 * « 0,00 € dépensés » (CLAUDE.md §7 : une valeur inconnue vaut `null`,
 * jamais 0).
 */

/**
 * Ce que ce mois-ci raconte : soit aucun appel n'a encore été journalisé,
 * soit un montant réel existe (même à 0,00 € — un appel journalisé qui a
 * coûté zéro cent, par exemple un échec avant tout appel réseau facturé, EST
 * une valeur, pas une absence).
 *
 * `depenseDuMoisCents` (`schemaEtatIa`) vaut TOUJOURS un entier — `COALESCE
 * (SUM(...), 0)` côté base (`packages/db/src/depots/ia.ts:72`) — y compris
 * quand aucun appel n'existe ce mois-ci. C'est donc `nbAppelsDuMois`, et lui
 * seul, qui porte l'information capable de distinguer les deux cas ; le
 * montant à lui seul ne le peut jamais.
 */
export type ResumeDepenseIa =
  | { statut: 'aucun_appel' }
  | { statut: 'montant'; depenseDuMoisCents: number; nbAppelsDuMois: number };

export type ResumeBudgetIa = {
  configuree: boolean;
  plafondMensuelCents: number;
  resteCents: number;
  depense: ResumeDepenseIa;
};

/**
 * Décide comment présenter l'état du budget IA, sans rien recalculer :
 * distingue « aucun appel journalisé ce mois-ci » de « 0,00 € dépensés » (voir
 * `ResumeDepenseIa` ci-dessus). `configuree` reste un fait INDÉPENDANT de la
 * dépense : une clé retirée en cours de mois laisse `depenseDuMoisCents` et
 * `nbAppelsDuMois` refléter les appels réellement passés plus tôt ce
 * mois-ci — les deux informations ne s'excluent donc jamais l'une l'autre.
 */
export function resumerBudgetIa(etat: EtatIa): ResumeBudgetIa {
  return {
    configuree: etat.configuree,
    plafondMensuelCents: etat.plafondMensuelCents,
    resteCents: etat.resteCents,
    depense:
      etat.nbAppelsDuMois === 0
        ? { statut: 'aucun_appel' }
        : {
            statut: 'montant',
            depenseDuMoisCents: etat.depenseDuMoisCents,
            nbAppelsDuMois: etat.nbAppelsDuMois,
          },
  };
}

const LIBELLE_USAGE: Readonly<Record<AppelIa['usage'], string>> = {
  prevision: 'Prévision',
  analyse_ecart: "Analyse d'écart",
  extraction: 'Extraction',
  synthese: 'Synthèse',
  evenements: 'Événements',
};

const COLONNES: ReadonlyArray<ColonneTableau<AppelIa>> = [
  {
    cle: 'quand',
    libelle: 'Quand',
    largeur: '12%',
    alignement: 'texte',
    rendu: (a) => formaterDateHeure(a.dateAppel),
    titre: (a) => formaterDateHeure(a.dateAppel),
  },
  {
    // « Analyse d'écart » (16 caractères, la plus longue des cinq valeurs de
    // `LIBELLE_USAGE`) n'avait ni `repli` ni `titre`.
    cle: 'usage',
    libelle: 'Usage',
    largeur: '10%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (a) => LIBELLE_USAGE[a.usage],
  },
  {
    cle: 'modele',
    libelle: 'Modèle',
    largeur: '14%',
    alignement: 'texte',
    // `repli` : deux variantes du même modèle (dates de version) ne se
    // distinguent que par leur fin — les couper par une ellipse les
    // confondrait dans le journal.
    troncature: 'repli',
    rendu: (a) => <span className="font-mono text-xs">{a.modele}</span>,
  },
  {
    // Mesuré à 1280 px : « Tokens (entrée → sortie) » (25 caractères) se
    // coupait en « Tokens (entré… » à 12 %. C'est l'en-tête le plus long de
    // l'écran ; les six autres colonnes lui cèdent chacune un peu de largeur.
    cle: 'tokens',
    libelle: 'Tokens (entrée → sortie)',
    largeur: '20%',
    alignement: 'nombre',
    rendu: (a) => (
      <span className="tabular-nums">
        {a.tokensEntree} → {a.tokensSortie}
      </span>
    ),
  },
  {
    // L'unité va dans l'en-tête, jamais répétée dans la cellule (docs/07
    // §4.5, mission du 31/07/2026) : `formaterMontant`, pas `formaterEuros`.
    cle: 'cout',
    libelle: 'Coût (€)',
    largeur: '10%',
    alignement: 'nombre',
    rendu: (a) => <span className="tabular-nums">{formaterMontant(a.coutCents)}</span>,
  },
  {
    cle: 'duree',
    libelle: 'Durée',
    largeur: '9%',
    alignement: 'nombre',
    // `null` = l'appel n'a jamais abouti (panne réseau avant toute réponse) :
    // le tiret d'absence, jamais « 0 ms » qui prétendrait à une mesure.
    rendu: (a) => <span className="tabular-nums">{ouTiret(a.dureeMs, (ms) => `${ms} ms`)}</span>,
  },
  {
    cle: 'valideeParHumain',
    libelle: 'Validée',
    largeur: '9%',
    alignement: 'texte',
    // `null` = cet usage n'alimente pas la base (un commentaire, par exemple)
    // et n'a donc jamais eu besoin de validation humaine — distinct de « non
    // validée ».
    rendu: (a) => ouTiret(a.valideeParHumain, (v) => (v ? 'oui' : 'non')),
  },
  {
    cle: 'erreur',
    libelle: 'Erreur',
    largeur: '16%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (a) => a.erreur ?? TIRET_ABSENT,
  },
];

type EtatEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; etatIa: EtatIa; appels: readonly AppelIa[] };

export default function AssistanceIa() {
  const [etat, setEtat] = useState<EtatEcran>({ statut: 'chargement' });

  useEffect(() => {
    let annule = false;
    setEtat({ statut: 'chargement' });

    Promise.all([
      requeteApi<unknown>('/ia/etat').then((brut) => schemaEtatIa.parse(brut)),
      requeteApi<unknown>('/ia/journal').then((brut) => schemaJournalIa.parse(brut)),
    ])
      .then(([etatIa, journal]) => {
        if (annule) return;
        setEtat({ statut: 'pret', etatIa, appels: journal.data });
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
      <div className="flex h-rangee items-center justify-between">
        <h1 className="text-lg text-ink">Assistance IA</h1>
      </div>

      {etat.statut === 'chargement' && <p className="text-sm text-ink-3">Chargement du budget…</p>}

      {etat.statut === 'erreur' && <MessageErreur message={etat.message} />}

      {etat.statut === 'pret' && <Contenu etatIa={etat.etatIa} appels={etat.appels} />}
    </div>
  );
}

function Contenu({ etatIa, appels }: { etatIa: EtatIa; appels: readonly AppelIa[] }) {
  const resume = resumerBudgetIa(etatIa);

  return (
    <div className="flex flex-col gap-bloc">
      <Panneau titre="Budget mensuel">
        <div className="flex flex-col gap-groupe">
          {!resume.configuree && (
            /* Mode dégradé (CLAUDE.md §5) : une clé absente est un état NORMAL
               du produit, affiché tel quel — jamais une erreur, jamais un
               bandeau d'alerte. Même registre que `CommentaireClaude` dans
               `ProchaineSession.tsx` pour `disponible: false`. */
            <p className="text-sm text-ink-2">
              Assistance Claude non configurée sur ce poste : aucune clé n'est renseignée.
              L'application reste pleinement fonctionnelle sans elle — l'IA est un confort, jamais
              une dépendance.
            </p>
          )}

          <dl className="grid grid-cols-3 gap-groupe border-t border-line pt-groupe text-sm">
            <div>
              <dt className="text-2xs uppercase text-ink-3">Plafond mensuel</dt>
              <dd className="tabular-nums text-ink">{formaterEuros(resume.plafondMensuelCents)}</dd>
            </div>
            <div>
              <dt className="text-2xs uppercase text-ink-3">Dépense de ce mois-ci</dt>
              <dd className="tabular-nums text-ink">
                {resume.depense.statut === 'aucun_appel' ? (
                  <span className="text-ink-3">Aucun appel journalisé.</span>
                ) : (
                  <>
                    {formaterEuros(resume.depense.depenseDuMoisCents)}
                    <span className="ml-1 text-xs text-ink-3">
                      ({resume.depense.nbAppelsDuMois} appel
                      {resume.depense.nbAppelsDuMois > 1 ? 's' : ''})
                    </span>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-2xs uppercase text-ink-3">Reste ce mois-ci</dt>
              <dd className="tabular-nums text-ink">{formaterEuros(resume.resteCents)}</dd>
            </div>
          </dl>
        </div>
      </Panneau>

      <div className="min-w-0">
        <Panneau
          titre={`${appels.length} appel${appels.length > 1 ? 's' : ''} journalisé${
            appels.length > 1 ? 's' : ''
          }`}
          sansRembourrage
        >
          <Tableau
            colonnes={COLONNES}
            lignes={appels}
            cleLigne={(a) => a.id}
            etatVide={<EtatVide variante="normal" texte="Aucun appel n'a encore été journalisé." />}
          />
        </Panneau>
      </div>
    </div>
  );
}
