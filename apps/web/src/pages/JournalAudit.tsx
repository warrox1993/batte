import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  TIRET_ABSENT,
  formaterDateHeure,
  formaterDateTableau,
  schemaJournalAudit,
  type ActionAuditContrat,
  type LigneAuditContrat,
} from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { MessageErreur } from '../composants/EncartErreur';
import { ErreurApi, requeteApi } from '../lib/api';
import { aujourdHui } from '../lib/dates';
import { compteAccorde } from './pluriel';

/**
 * Écran Journal d'audit — groupe CONTRÔLE de la navigation.
 *
 * POURQUOI ICI. `CLAUDE.md` §3 règle 7 exige un « journal d'audit sur toutes
 * les tables sensibles ». Il est tenu — huit sites appellent `journaliser` — et
 * il était strictement illisible : `listerJournalAudit` n'avait aucun appelant
 * de production et aucune route ne l'exposait (`docs/13` §4.9). Un journal
 * qu'on ne peut pas ouvrir coûte des écritures et ne rend aucun service.
 *
 * POURQUOI DANS « CONTRÔLE » ET PAS AILLEURS. Ce n'est pas un écran quotidien,
 * et le mettre dans « Exploitation » le placerait sur le chemin d'un geste
 * hebdomadaire qu'il ne sert pas. Le groupe CONTRÔLE réunit déjà les trois
 * écrans qui répondent à « prouve-le » — Comptabilité, Registre AFSCA, Qualité
 * du modèle : ce qu'on ouvre pour justifier un chiffre devant quelqu'un
 * d'autre. Le journal d'audit répond à la même famille de questions, et à deux
 * en particulier :
 *
 *   — « qui a changé ce seuil, et quand ? »
 *   — « pourquoi cette valeur a-t-elle bougé entre deux exercices ? »
 *
 * Il est placé en DERNIER du groupe : `docs/06` fixe l'ordre par fréquence
 * d'usage réelle, et celui-ci est le moins fréquent de tous. Rare, mais
 * trouvable le jour où on le cherche — c'est exactement le cahier des charges.
 *
 * CE QUE CET ÉCRAN NE FAIT PAS. Il n'écrit rien, jamais. Le journal
 * s'alimente depuis la transaction qui modifie la donnée ; un journal
 * rectifiable, ou alimentable depuis un écran, ne prouve plus rien.
 *
 * Règle d'architecture n°1 : aucun calcul métier. La comparaison de deux
 * instantanés est une comparaison de champs, pas une arithmétique — même
 * nature que le tri, que `docs/07` §4.5 autorise explicitement. Elle est
 * isolée dans `differencesAudit`, exportée et testée.
 */

const LIBELLE_ACTION: Readonly<Record<ActionAuditContrat, string>> = {
  creation: 'Création',
  modification: 'Modification',
  annulation: 'Annulation',
};

/** Horizon par défaut du filtre : douze mois. Un exercice comptable complet. */
const MOIS_PAR_DEFAUT = 12;

const CLASSE_CHAMP =
  'h-controle rounded-sm border border-line-field bg-surface px-2 text-base text-ink';

export type DifferenceAudit = {
  readonly champ: string;
  readonly avant: string;
  readonly apres: string;
};

/**
 * Rend une valeur d'instantané LISIBLE, sans jamais mentir sur son type.
 *
 * `null` s'écrit avec le tiret d'absence et non « null » : le journal se relit
 * par quelqu'un qui n'a pas écrit le schéma. Un booléen s'écrit « oui »/« non »
 * pour la même raison. Tout le reste — objets, tableaux — est rendu tel quel en
 * JSON : mieux vaut une valeur brute qu'un résumé qui perd ce qu'on cherchait.
 */
export function formaterValeurAudit(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return TIRET_ABSENT;
  if (typeof valeur === 'boolean') return valeur ? 'oui' : 'non';
  if (typeof valeur === 'string') return valeur === '' ? TIRET_ABSENT : valeur;
  if (typeof valeur === 'number') return String(valeur);
  return JSON.stringify(valeur);
}

/**
 * Champs qui ont RÉELLEMENT changé entre deux instantanés.
 *
 * Le journal fige la ligne ENTIÈRE à chaque geste (voir `depots/audit.ts`), ce
 * qui est le bon choix : la valeur seule ne se relit pas sans sa clé ni sa
 * période de validité. Mais afficher trente colonnes identiques pour signaler
 * qu'une seule a bougé enterre l'information sous elle-même. On ne montre donc
 * que la différence — le reste reste consultable dans l'instantané complet.
 *
 * `modifie_le` est écarté : il change à CHAQUE modification par construction et
 * n'apprend rien de plus que la date de l'entrée elle-même, déjà en colonne.
 */
const CHAMPS_TECHNIQUES: ReadonlySet<string> = new Set(['modifie_le', 'modifieLe']);

export function differencesAudit(
  avant: Readonly<Record<string, unknown>> | null,
  apres: Readonly<Record<string, unknown>> | null,
): DifferenceAudit[] {
  const cles = [...new Set([...Object.keys(avant ?? {}), ...Object.keys(apres ?? {})])].sort();

  return cles
    .filter((cle) => !CHAMPS_TECHNIQUES.has(cle))
    .map((cle) => ({
      champ: cle,
      avant: formaterValeurAudit(avant?.[cle]),
      apres: formaterValeurAudit(apres?.[cle]),
    }))
    .filter((difference) => difference.avant !== difference.apres);
}

/** Résumé d'une ligne : ce qui a bougé, en une cellule. */
function resumeChangement(ligne: LigneAuditContrat): string {
  const differences = differencesAudit(ligne.valeurAvant, ligne.valeurApres);
  if (differences.length === 0) return TIRET_ABSENT;
  return differences.map((d) => d.champ).join(', ');
}

type EtatJournal =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | {
      statut: 'pret';
      lignes: LigneAuditContrat[];
      total: number;
      limite: number;
      tronque: boolean;
      tables: string[];
    };

const COLONNES: ReadonlyArray<ColonneTableau<LigneAuditContrat>> = [
  {
    cle: 'quand',
    libelle: 'Quand',
    largeur: '16%',
    alignement: 'texte',
    // L'heure compte autant que le jour : deux corrections d'un même paramètre
    // le même après-midi ne se départagent que par elle.
    rendu: (l) => formaterDateHeure(l.dateAction),
    titre: (l) => formaterDateHeure(l.dateAction),
  },
  {
    cle: 'table',
    libelle: 'Table',
    largeur: '14%',
    alignement: 'texte',
    // `repli` : `production_consommation` et `produit_garniture` se coupent au
    // même endroit, et le suffixe est ce qui les distingue.
    troncature: 'repli',
    rendu: (l) => <span className="font-mono text-xs">{l.table}</span>,
  },
  {
    cle: 'action',
    libelle: 'Action',
    largeur: '12%',
    alignement: 'texte',
    rendu: (l) => LIBELLE_ACTION[l.action],
  },
  {
    cle: 'enregistrement',
    libelle: 'Enregistrement',
    largeur: '22%',
    alignement: 'texte',
    // Un identifiant tronqué ne se recherche pas : c'est la seule clé qui
    // permet de retrouver la ligne concernée dans sa propre table.
    troncature: 'repli',
    rendu: (l) => <span className="font-mono text-xs">{l.enregistrementId}</span>,
  },
  {
    cle: 'changement',
    libelle: 'Champs modifiés',
    largeur: '26%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (l) => resumeChangement(l),
  },
  {
    cle: 'qui',
    libelle: 'Par',
    largeur: '10%',
    alignement: 'texte',
    // Nullable : pas d'authentification en V1 (D-001). Le tiret dit « non
    // renseigné », il ne prétend pas à un utilisateur anonyme.
    rendu: (l) => l.parQui ?? TIRET_ABSENT,
  },
];

function ChampFiltre({
  identifiant,
  libelle,
  children,
}: {
  identifiant: string;
  libelle: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-groupe text-sm text-ink-2" htmlFor={identifiant}>
      {libelle}
      {children}
    </label>
  );
}

/** Premier jour de l'horizon par défaut, calculé sur le calendrier belge. */
function debutParDefaut(): string {
  const jour = aujourdHui();
  const annee = Number.parseInt(jour.slice(0, 4), 10);
  const mois = Number.parseInt(jour.slice(5, 7), 10);
  const total = annee * 12 + (mois - 1) - MOIS_PAR_DEFAUT;
  const anneeCible = Math.floor(total / 12);
  const moisCible = (total % 12) + 1;
  return `${String(anneeCible).padStart(4, '0')}-${String(moisCible).padStart(2, '0')}-01`;
}

export default function JournalAudit() {
  const [etat, setEtat] = useState<EtatJournal>({ statut: 'chargement' });
  const [table, setTable] = useState('');
  const [action, setAction] = useState('');
  const [depuis, setDepuis] = useState(debutParDefaut);
  const [jusqua, setJusqua] = useState(aujourdHui);
  const [ligneSelectionneeId, setLigneSelectionneeId] = useState<string | null>(null);

  const anneeReference = Number.parseInt(aujourdHui().slice(0, 4), 10);

  /**
   * Tables proposées au filtre : elles viennent du serveur et sont donc celles
   * qui sont RÉELLEMENT tracées. Une liste écrite à la main proposerait des
   * tables vides et tairait celles qu'un futur appel à `journaliser` ajoutera.
   * Conservée entre deux chargements pour que le filtre ne se vide pas quand
   * une recherche ne ramène rien.
   */
  const [tablesConnues, setTablesConnues] = useState<string[]>([]);

  useEffect(() => {
    let annule = false;
    setEtat({ statut: 'chargement' });

    const parametres = new URLSearchParams();
    if (table !== '') parametres.set('table', table);
    if (action !== '') parametres.set('action', action);
    if (depuis !== '') parametres.set('depuis', depuis);
    if (jusqua !== '') parametres.set('jusqua', jusqua);

    requeteApi<unknown>(`/audit?${parametres.toString()}`)
      .then((reponse) => {
        const journal = schemaJournalAudit.parse(reponse);
        if (annule) return;
        setEtat({
          statut: 'pret',
          lignes: journal.data,
          total: journal.meta.total,
          limite: journal.meta.limite,
          tronque: journal.meta.tronque,
          tables: journal.meta.tables,
        });
        setTablesConnues(journal.meta.tables);
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
  }, [table, action, depuis, jusqua]);

  /**
   * `useMemo` et non un ternaire : la branche « pas encore chargé » rend un
   * tableau NEUF à chaque rendu, donc tout ce qui en dépend se recalculerait à
   * chaque frappe dans les filtres. Même raison que dans `SaisieSortie`.
   */
  const lignes = useMemo(() => (etat.statut === 'pret' ? etat.lignes : []), [etat]);

  const ligneSelectionnee = useMemo(
    () => lignes.find((l) => l.id === ligneSelectionneeId) ?? null,
    [lignes, ligneSelectionneeId],
  );

  /**
   * Ferme le panneau de détail et rend le focus à la ligne du tableau, sans
   * quoi il retomberait sur `<body>` au moment où le bouton « Fermer »
   * disparaît. `Tableau.tsx` pose déjà `aria-selected="true"` sur la rangée
   * active : c'est le seul repère DOM disponible depuis cet écran sans
   * modifier `Tableau`, partagé par la quasi-totalité des écrans (mesuré le
   * 01/08/2026 : 72 instanciations dans 29 fichiers de production). Le
   * modifier pour un seul écran se paierait partout ailleurs.
   */
  function fermerDetail(): void {
    const ligne = document.querySelector<HTMLTableRowElement>('tr[aria-selected="true"]');
    setLigneSelectionneeId(null);
    ligne?.focus();
  }

  // « Échap ferme » (docs/07 §4.6), même patron que les autres écrans.
  useEffect(() => {
    if (ligneSelectionneeId === null) return;
    function surAppuiTouche(evenement: KeyboardEvent): void {
      if (evenement.key === 'Escape') fermerDetail();
    }
    window.addEventListener('keydown', surAppuiTouche);
    return () => window.removeEventListener('keydown', surAppuiTouche);
  }, [ligneSelectionneeId]);

  const differences = useMemo(
    () =>
      ligneSelectionnee === null
        ? []
        : differencesAudit(ligneSelectionnee.valeurAvant, ligneSelectionnee.valeurApres),
    [ligneSelectionnee],
  );

  return (
    <div className="flex flex-col gap-bloc">
      <div className="flex h-rangee items-center justify-between">
        <h1 className="text-lg text-ink">Journal d'audit</h1>
        {etat.statut === 'pret' && (
          <p className="text-sm text-ink-2">
            {etat.total} entrée{etat.total > 1 ? 's' : ''}
            {etat.tronque ? ` — ${etat.limite} affichées, affinez la période` : ''}
          </p>
        )}
      </div>

      <Panneau titre="Filtres">
        <div className="flex flex-wrap items-end gap-bloc">
          <ChampFiltre identifiant="audit-table" libelle="Table">
            <select
              id="audit-table"
              className={`${CLASSE_CHAMP} w-56`}
              value={table}
              onChange={(evenement) => {
                setTable(evenement.target.value);
                setLigneSelectionneeId(null);
              }}
            >
              <option value="">Toutes</option>
              {tablesConnues.map((nom) => (
                <option key={nom} value={nom}>
                  {nom}
                </option>
              ))}
            </select>
          </ChampFiltre>

          <ChampFiltre identifiant="audit-action" libelle="Action">
            <select
              id="audit-action"
              className={`${CLASSE_CHAMP} w-44`}
              value={action}
              onChange={(evenement) => {
                setAction(evenement.target.value);
                setLigneSelectionneeId(null);
              }}
            >
              <option value="">Toutes</option>
              <option value="creation">Création</option>
              <option value="modification">Modification</option>
              <option value="annulation">Annulation</option>
            </select>
          </ChampFiltre>

          <ChampFiltre identifiant="audit-depuis" libelle="Depuis">
            <input
              id="audit-depuis"
              type="date"
              className={`${CLASSE_CHAMP} w-40`}
              value={depuis}
              onChange={(evenement) => {
                setDepuis(evenement.target.value);
                setLigneSelectionneeId(null);
              }}
            />
          </ChampFiltre>

          <ChampFiltre identifiant="audit-jusqua" libelle="Jusqu'au">
            <input
              id="audit-jusqua"
              type="date"
              className={`${CLASSE_CHAMP} w-40`}
              value={jusqua}
              onChange={(evenement) => {
                setJusqua(evenement.target.value);
                setLigneSelectionneeId(null);
              }}
            />
          </ChampFiltre>
        </div>

        {/* Mention obligatoire du même ordre que celles des écrans de synthèse
            fiscale (CLAUDE.md §7) : le journal enregistre ce qui a été saisi,
            avec sa date de saisie réelle. Il ne se reconstitue pas après coup. */}
        <p className="mt-bloc text-xs text-ink-3">
          Ce journal est en lecture seule et ne se corrige pas : chaque entrée porte la date réelle
          de l'action. Il enregistre les créations et les modifications des tables sensibles, ainsi
          que les contrepassations de mouvements de stock.
        </p>
      </Panneau>

      {etat.statut === 'chargement' && <p className="text-sm text-ink-3">Chargement du journal…</p>}

      {etat.statut === 'erreur' && <MessageErreur message={etat.message} />}

      {etat.statut === 'pret' && (
        <div className="flex flex-col gap-bloc">
          <div className="min-w-0">
            <Panneau
              titre={compteAccorde(lignes.length, 'entrée affichée', 'entrées affichées')}
              sansRembourrage
            >
              <Tableau
                colonnes={COLONNES}
                lignes={lignes}
                cleLigne={(l) => l.id}
                {...(ligneSelectionneeId !== null
                  ? { ligneSelectionneeCle: ligneSelectionneeId }
                  : {})}
                onSelectionnerLigne={(ligne) =>
                  setLigneSelectionneeId((precedent) => (precedent === ligne.id ? null : ligne.id))
                }
                etatVide={
                  <EtatVide
                    variante="normal"
                    texte="Aucune entrée sur cette période. Élargissez les dates ou retirez le filtre de table."
                  />
                }
              />
            </Panneau>
          </div>

          {ligneSelectionnee !== null && (
            <div className="min-w-0">
              <Panneau
                titre={`${LIBELLE_ACTION[ligneSelectionnee.action]} — ${ligneSelectionnee.table}`}
                sansRembourrage
              >
                <div className="flex items-center justify-between border-b border-line px-4 py-2">
                  <p className="text-xs text-ink-3">
                    {formaterDateHeure(ligneSelectionnee.dateAction)}
                    {' · enregistrement '}
                    <span className="font-mono text-xs text-ink">
                      {ligneSelectionnee.enregistrementId}
                    </span>
                    {' · par '}
                    {ligneSelectionnee.parQui ?? 'non renseigné (V1 sans authentification)'}
                  </p>
                  <button
                    type="button"
                    onClick={fermerDetail}
                    className="text-xs font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Fermer
                  </button>
                </div>

                {differences.length === 0 ? (
                  <p className="px-4 py-2 text-sm text-ink-3">
                    Aucun champ n'a changé de valeur entre les deux instantanés.
                  </p>
                ) : (
                  <table>
                    <colgroup>
                      <col style={{ width: '28%' }} />
                      <col style={{ width: '36%' }} />
                      <col style={{ width: '36%' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">Champ</th>
                        <th scope="col">Avant</th>
                        <th scope="col">Après</th>
                      </tr>
                    </thead>
                    <tbody>
                      {differences.map((difference) => (
                        <tr key={difference.champ}>
                          <td className="font-mono text-xs" data-troncature="repli">
                            {difference.champ}
                          </td>
                          {/* `repli` sur les deux valeurs : c'est le couple
                              avant/après qui est la réponse à « pourquoi cette
                              valeur a-t-elle bougé ? ». Une valeur coupée par
                              la fin ne répond plus. */}
                          <td data-troncature="repli">{difference.avant}</td>
                          <td data-troncature="repli">{difference.apres}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
                  Entrée du {formaterDateTableau(ligneSelectionnee.dateAction, anneeReference)} —
                  les instantanés complets, avant et après, restent figés en base.
                </p>
              </Panneau>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
