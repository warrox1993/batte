import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  formaterDate,
  formaterEuros,
  formaterPointsDeBase,
  jourCivilBelge,
  schemaListeParametres,
  type Parametre,
} from '@batte/core';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { MessageErreur } from '../composants/EncartErreur';
import { EnveloppeChamp } from '../composants/champs-formulaire';
import { ErreurApi, requeteApi, type ChampsEnErreur } from '../lib/api';
import { compteAccorde } from './pluriel';

/**
 * Ecran Parametres — consultation ET evolution des valeurs de reference.
 *
 * Le point qui gouverne tout le dessin de cet ecran : **un parametre n'a pas
 * une valeur, il a une SUITE DE VERSIONS DATEES.** `lireParametres(base, date)`
 * resout la valeur applicable a une date donnee, pour qu'une session de mars se
 * relise avec les taux de mars. L'ecran doit donc rendre le temps visible, et
 * surtout separer deux gestes que l'utilisateur confondrait spontanement :
 *
 *  - **Corriger** — la valeur saisie etait fausse, elle n'a jamais ete vraie.
 *    Faute de frappe. Elle est rectifiee en place, retroactivement.
 *  - **Faire evoluer** — la valeur etait juste et change a partir d'une date.
 *    Le seuil de franchise TVA en 2027. Une nouvelle version est ajoutee, et
 *    les sessions deja cloturees gardent le seuil de leur epoque.
 *
 * Presenter les deux comme un seul bouton « Modifier » ferait reecrire des
 * pieces comptables closes en croyant reparer une coquille. D'ou deux actions
 * nommees, et jamais un menu deroulant obscur.
 */

type EtatEcran =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; lignes: Parametre[] };

/** Ce que l'utilisateur est en train de faire sur la fiche ouverte. */
type ModeFiche = 'consultation' | 'evolution' | 'correction';

/**
 * Formate la valeur brute pour l'affichage, sans jamais recalculer un chiffre
 * metier (regle d'architecture n°1) : le seul travail ici est de choisir le
 * bon formateur de `@batte/core` selon la convention de suffixe de cle
 * (`_cents` -> montant, `_bp` -> points de base), deja en usage dans
 * `packages/core/src/parametres.ts`.
 */
function valeurAffichee(ligne: Parametre): string {
  if (ligne.cle.endsWith('_cents')) return formaterEuros(Number(ligne.valeur));
  if (ligne.cle.endsWith('_bp')) return formaterPointsDeBase(Number(ligne.valeur));
  return ligne.valeur;
}

/**
 * Toutes les versions d'une meme cle, et celle qui s'applique aujourd'hui.
 * `versions` est triee de la PLUS RECENTE a la plus ancienne : un historique se
 * lit du present vers le passe.
 */
type Fiche = {
  cle: string;
  versions: Parametre[];
  enVigueur: Parametre;
};

/**
 * Regroupe les lignes par cle et designe la version en vigueur a `jour`.
 *
 * Reproduit fidelement la resolution SQL de `lireParametres` : la version
 * retenue est la plus recente dont la date de debut est deja passee et, si
 * aucune ne l'est encore, on retombe sur la PLUS ANCIENNE. Ce repli n'est pas
 * une commodite d'affichage — c'est le comportement documente du depot, et
 * l'ecran mentirait s'il affichait « aucune valeur » la ou le moteur en lit une.
 */
function regrouperParCle(lignes: readonly Parametre[], jour: string): Fiche[] {
  const parCle = new Map<string, Parametre[]>();
  for (const ligne of lignes) {
    const deja = parCle.get(ligne.cle);
    if (deja === undefined) parCle.set(ligne.cle, [ligne]);
    else deja.push(ligne);
  }

  return [...parCle.entries()]
    .map(([cle, brutes]) => {
      // Tri descendant sur la date de debut : la version la plus recente d'abord.
      const versions = [...brutes].sort((a, b) =>
        b.dateDebutValidite.localeCompare(a.dateDebutValidite),
      );
      const applicable = versions.find((v) => v.dateDebutValidite <= jour);
      const derniere = versions[versions.length - 1];
      // `versions` n'est jamais vide : la cle vient d'une ligne existante.
      const enVigueur = applicable ?? derniere ?? versions[0];
      if (enVigueur === undefined) throw new Error(`Paramètre sans version : ${cle}`);
      return { cle, versions, enVigueur };
    })
    .sort((a, b) => a.cle.localeCompare(b.cle));
}

/**
 * Insère un point de rupture invisible (`<wbr>`) après chaque « _ » d'une clé
 * de paramètre.
 *
 * MESURÉ le 31/07/2026 à 1280×720, fiche ouverte, table à 634 px : même à
 * 46 % (292 px de colonne), `overflow-wrap: anywhere` (index.css, hors zone
 * d'écriture) coupe 34 des 99 clés au milieu d'un mot dès qu'aucun point de
 * rupture « naturel » n'existe avant la limite de largeur — un « _ » n'en est
 * pas un pour le moteur de rendu. `cout_kilometrique_mesure_pleins_minimum`
 * se coupait ainsi en `cout_kilometrique_mesure_pleins_mini` / `mum`,
 * scindant « minimum » en deux. `<wbr>` crée une opportunité de rupture APRÈS
 * chaque « _ » sans ajouter aucun caractère : contrairement à une espace
 * insécable ou un caractère à chasse nulle, il ne fait jamais partie du texte
 * sélectionné ou copié — recopier la clé depuis l'écran donne exactement la
 * même chaîne que dans le code. `overflow-wrap: anywhere` continue de couper
 * au milieu d'un mot en tout dernier recours (repli du repli), mais choisit
 * désormais la dernière rupture « _ » qui tient dans la largeur avant d'en
 * arriver là.
 */
export function decouperCleAvecPointsDeRupture(cle: string): ReactNode[] {
  const segments = cle.split('_');
  return segments.flatMap((segment, index) =>
    index === 0 ? [segment] : ['_', <wbr key={index} />, segment],
  );
}

/**
 * Longueur, en caracteres, au-dela de laquelle une valeur de parametre ne
 * peut PLUS tenir dans la colonne « En vigueur » — a AUCUNE des trois largeurs
 * couvertes par l'application (docs/07-DOCTRINE-ERP-ET-DESIGN.md §4.4 :
 * 1280 large, 1920×1080, 2560×1440). MESURE le 01/08/2026
 * (docs/36-AUDIT-TROIS-RESOLUTIONS.md §2 rang 3) : la colonne fait 383 px a
 * la plus large des trois cibles, quand une citation legale type
 * (`echeance_e604b_source_legale`) en occupe plus de 500. Choisie loin de
 * TOUT cas reel de `packages/core/src/parametres.ts` : le plus long
 * identifiant fonctionnel de la table (`ia_modele_extraction`,
 * `claude-haiku-4-5-20251001`, 25 caracteres) reste largement en dessous ; la
 * plus courte des six valeurs structurellement trop longues (le tableau JSON
 * `afsca_motifs_incident_sanitaire_json`, 72 caracteres) reste largement
 * au-dessus — voir `Parametres.test.tsx`.
 */
const LONGUEUR_MAX_VALEUR_LISTE = 40;

/**
 * Une valeur au-dela de ce seuil n'est plus une DONNEE TABULAIRE : c'est un
 * texte a LIRE (citation legale, liste de codes motif AFSCA), jamais une
 * grandeur a comparer ligne a ligne. Fonction PURE et exportee pour que la
 * decision reste prouvable sans monter le tableau.
 */
export function valeurTropLonguePourListe(valeur: string): boolean {
  return valeur.length > LONGUEUR_MAX_VALEUR_LISTE;
}

/**
 * Colonnes definies une fois, hors composant : la reference reste stable
 * entre rendus. Une rangee = une CLE, pas une version : la liste repond
 * « quelle valeur s'applique aujourd'hui ? », l'historique complet vit sur la
 * fiche (docs/07 §0, « historique sur la fiche »).
 *
 * Repartition MESUREE le 31/07/2026 (table a 634 px a 1280x720, fiche
 * ouverte) : « Depuis le » et « Versions » etaient bien plus larges que leur
 * contenu n'exige — une date tient en 10 caracteres, un compte de version
 * quasiment toujours en 1 — alors que la CLE, seule colonne dont la troncature
 * perd de l'information, en manquait. Cede : 18→16 % (« Depuis le », encore
 * ~5 px de marge sur « 01/01/2026 ») et 16→10 % (« Versions »). Recu : 46→54 %
 * (« Clé »). « En vigueur » reste a 20 %, INTOUCHEE : ce sont les montants de
 * seuil legal que CLAUDE.md §6 demande de surveiller, une colonne qui n'a
 * jamais son propre defaut ne doit pas payer celui d'une autre.
 */
const COLONNES: ReadonlyArray<ColonneTableau<Fiche>> = [
  {
    // La cle EST l'identifiant de la rangee : deux parametres distincts ne
    // doivent jamais se ressembler a l'ecran (docs/07 §4.5 sur la troncature),
    // elle recoit donc la plus grande part de la largeur disponible.
    cle: 'cle',
    libelle: 'Clé',
    largeur: '54%',
    alignement: 'texte',
    // `repli` : la cle est l'identifiant de sa rangee, elle ne se tronque
    // jamais par une ellipse qui perdrait des caracteres. Voir
    // `decouperCleAvecPointsDeRupture` ci-dessus pour ce qui rend ce repli
    // lisible plutot que de couper au milieu d'un mot.
    troncature: 'repli',
    rendu: (fiche) => (
      <span className="font-mono text-xs">{decouperCleAvecPointsDeRupture(fiche.cle)}</span>
    ),
    // Le `titre` reste : confort a la souris quand la cle passe sur deux lignes.
    titre: (fiche) => fiche.cle,
  },
  {
    // Les montants de seuil legal (25 000,00 €, 23 000,00 €, 17 374,08 €) se
    // coupaient de 5 px. Ce sont exactement les chiffres que CLAUDE.md §6
    // demande de surveiller : ils se lisent en entier ou ils ne servent a rien.
    // La largeur de cette colonne reste a 20 %, INTOUCHEE pour ces montants —
    // voir ci-dessous pourquoi les six valeurs plus longues qu'elle ne servent
    // PAS d'argument pour l'agrandir.
    cle: 'valeur',
    libelle: 'En vigueur',
    largeur: '20%',
    alignement: 'nombre',
    // MISSION du 01/08/2026 (docs/36-AUDIT-TROIS-RESOLUTIONS.md §2 rang 3) :
    // cinq echeances portent une citation legale ENTIERE en guise de valeur
    // (`echeance_e604b_source_legale` et consorts,
    // packages/core/src/parametres.ts) et une porte un tableau JSON de codes
    // motif AFSCA (`afsca_motifs_incident_sanitaire_json`) — ce ne sont pas
    // des grandeurs, ce sont des textes a lire. Aucune largeur de colonne
    // testee ne les contient : meme a 2560 px (383 px de colonne, la plus
    // large des trois cibles), il en reste 6 tronquees. Ce n'est donc PAS un
    // manque de place — grandir la colonne ne resoudrait rien et couterait de
    // la largeur a la cle, la seule colonne qui identifie sa rangee.
    //
    // Le remede habituel (ellipse + infobulle, « texte libre » de
    // docs/05-DECISIONS.md) est ECARTE ICI : une citation legale ne se lit
    // pas au survol, et une coupe au milieu perd l'information EN SILENCE —
    // ex. « À déposer avant le 15 décembre en cas de dépasse… » cache que la
    // tolerance de 10 % a disparu, la partie la plus importante de la phrase.
    // La cellule dit donc explicitement ce qu'elle est (un texte trop long
    // pour la liste) plutot que d'en montrer un fragment trompeur. La valeur
    // COMPLETE, elle, ne disparait nulle part : elle s'affiche integralement,
    // sans aucune coupe, sur la fiche ouverte a droite (`FicheParametre`
    // ci-dessous) des qu'une rangee est selectionnee — au clavier (Entree/
    // Espace sur la rangee active, `Tableau.tsx`) comme a la souris.
    rendu: (fiche) => {
      const brute = valeurAffichee(fiche.enVigueur);
      if (!valeurTropLonguePourListe(brute)) return brute;
      // `italic text-ink-3` : meme convention que PrevisionCalendaire.tsx
      // pour « ceci n'est pas une valeur, c'est une explication » — pas une
      // couleur ni un glyphe nouveau.
      return <span className="italic text-ink-3">Voir la fiche</span>;
    },
    titre: (fiche) => {
      const brute = valeurAffichee(fiche.enVigueur);
      // Pas d'infobulle qui reafficherait la citation en entier : ce serait
      // exactement le remede ecarte ci-dessus. Elle explique seulement le
      // renvoi vers la fiche.
      return valeurTropLonguePourListe(brute)
        ? 'Valeur trop longue pour tenir dans la liste — sélectionnez la ligne pour la lire en entier sur la fiche.'
        : brute;
    },
  },
  {
    // En-tete raccourci plutot qu'elargi : « Début de validité » se coupait, et
    // la colonne ne contient que des dates courtes (10 caracteres).
    cle: 'debut',
    libelle: 'Depuis le',
    largeur: '16%',
    alignement: 'texte',
    rendu: (fiche) => formaterDate(fiche.enVigueur.dateDebutValidite),
  },
  {
    // Un nombre, donc a droite et cliquable : selectionner la rangee ouvre
    // exactement la liste qui l'a produit (docs/07 §2.2). C'est aussi le seul
    // signal qui distingue d'un coup d'oeil un seuil deja versionne d'un
    // parametre encore a sa valeur d'origine. Contenu borne (1-2 chiffres) :
    // 10 % suffit largement, le reste va a la cle.
    cle: 'versions',
    libelle: 'Versions',
    largeur: '10%',
    alignement: 'nombre',
    rendu: (fiche) => fiche.versions.length,
  },
  // Pas de colonne « Source » ici, volontairement : ces textes font des phrases
  // entieres et, dans les ~140 px que la table pouvait leur donner, ils se
  // reduisaient tous a « docs/0… » ou « CLAU… » — une colonne qui n'apprend
  // rien tout en volant sa largeur a la cle. La source complete se lit sur la
  // fiche, version par version, la ou elle a un sens.
];

/** Effacement du message de succes (docs/07 §4.7 : succes 5 s, erreur persistante). */
const DELAI_SUCCES_MS = 5000;

const CLASSE_CHAMP =
  'h-controle w-full rounded-sm border border-line-field bg-surface px-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';
const CLASSE_BOUTON_PRIMAIRE =
  'h-controle min-w-[7.5rem] rounded-sm bg-accent px-3 text-sm text-on-accent hover:bg-accent-hover disabled:bg-ink-4';
const CLASSE_BOUTON_SECONDAIRE =
  'h-controle rounded-sm border border-line-field px-3 text-sm text-ink-2 hover:bg-surface-sunken';

export default function Parametres() {
  const [etat, setEtat] = useState<EtatEcran>({ statut: 'chargement' });
  const [cleSelectionnee, setCleSelectionnee] = useState<string | null>(null);
  const [mode, setMode] = useState<ModeFiche>('consultation');

  // Le jour civil belge est fige au montage : recalcule a chaque rendu, il
  // rendrait `regrouperParCle` instable sans raison (CLAUDE.md §3 regle 8).
  const aujourdHui = useMemo(() => jourCivilBelge(new Date()), []);

  const charger = useCallback(async () => {
    try {
      const brut = await requeteApi<unknown>('/parametres');
      // On valide ce que le serveur a reellement envoye au lieu de le supposer :
      // une reponse hors contrat devient une erreur affichee, pas un ecran
      // a moitie rempli.
      const liste = schemaListeParametres.parse(brut);
      setEtat({ statut: 'pret', lignes: liste.data });
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

  const fiches = useMemo(
    () => (etat.statut === 'pret' ? regrouperParCle(etat.lignes, aujourdHui) : []),
    [etat, aujourdHui],
  );

  const ficheActive = fiches.find((f) => f.cle === cleSelectionnee) ?? null;

  // Selectionner une autre cle repart toujours en consultation : conserver un
  // formulaire ouvert d'une fiche a l'autre ferait saisir la nouvelle valeur
  // d'un seuil sur le mauvais parametre.
  function selectionner(cle: string): void {
    setCleSelectionnee(cle);
    setMode('consultation');
  }

  // « Échap ferme » (docs/07 §4.6) : les modes `evolution` et `correction` sont
  // exactement les couches que la règle vise. Sans cela, la seule sortie était
  // le bouton « Annuler », à la souris ou après plusieurs tabulations.
  useEffect(() => {
    if (mode === 'consultation') return;
    function surAppuiTouche(evenement: KeyboardEvent): void {
      if (evenement.key === 'Escape') setMode('consultation');
    }
    window.addEventListener('keydown', surAppuiTouche);
    return () => window.removeEventListener('keydown', surAppuiTouche);
  }, [mode]);

  return (
    <div className="flex flex-col gap-bloc">
      <h1 className="flex h-rangee items-center text-lg text-ink">Paramètres</h1>
      <p className="max-w-[80ch] text-sm text-ink-2">
        Seuils légaux, taux et capacités matérielles. Aucune de ces valeurs n'est codée en dur dans
        l'application. Un paramètre ne se remplace pas : il gagne une version datée, et les sessions
        déjà clôturées continuent d'être lues avec la valeur de leur époque. Les seuils 2026 sont à
        reconfirmer chaque année.
      </p>

      {etat.statut === 'chargement' && (
        <p className="text-sm text-ink-3">Chargement des paramètres…</p>
      )}

      {/*
        Le catalogue n'a pas pu être chargé : c'est une panne, pas un fait
        métier. Elle ne demande aucune décision au porteur et ne doit donc pas
        emprunter le registre d'alerte, qui doit rester rare pour rester
        lisible (balayage du 01/08/2026, 78 emplacements corrigés).
      */}
      {etat.statut === 'erreur' && <MessageErreur message={etat.message} />}

      {etat.statut === 'pret' && (
        <div className="flex flex-col items-start gap-bloc lg:flex-row">
          <div className="min-w-0 flex-1 self-stretch">
            <Panneau
              titre={compteAccorde(fiches.length, 'paramètre', 'paramètres')}
              sansRembourrage
            >
              <Tableau
                colonnes={COLONNES}
                lignes={fiches}
                cleLigne={(fiche) => fiche.cle}
                // `exactOptionalPropertyTypes` interdit un `undefined` explicite
                // sur une prop optionnelle : on ne la fournit que si une fiche
                // est reellement selectionnee.
                {...(cleSelectionnee !== null ? { ligneSelectionneeCle: cleSelectionnee } : {})}
                onSelectionnerLigne={(fiche) => selectionner(fiche.cle)}
                etatVide={
                  <EtatVide
                    variante="premier-lancement"
                    titre="Aucun paramètre enregistré"
                    explication="Le catalogue de paramètres n'a pas encore été initialisé en base. Lancez « npm run db:seed » pour charger les valeurs par défaut 2026."
                  />
                }
              />
            </Panneau>
          </div>

          {/* 360 px : au-dela, la table passait sous 600 px et tronquait ses
              cles ; en deca, l'historique et les trois champs du formulaire ne
              tiennent plus sans enroulement. */}
          <div className="w-full lg:w-[22.5rem] lg:shrink-0">
            <FicheParametre
              fiche={ficheActive}
              aujourdHui={aujourdHui}
              mode={mode}
              onChangerMode={setMode}
              onEcrit={() => void charger()}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ Fiche d'un parametre ══════════════════════════════════════════════════ */

function FicheParametre({
  fiche,
  aujourdHui,
  mode,
  onChangerMode,
  onEcrit,
}: {
  fiche: Fiche | null;
  aujourdHui: string;
  mode: ModeFiche;
  onChangerMode: (mode: ModeFiche) => void;
  onEcrit: () => void;
}) {
  // Quitter un formulaire (« Annuler » ou `Échap`) démonte le bouton qui avait
  // le focus : on le rend au bouton qui a OUVERT ce mode précis — « Faire
  // évoluer… » ou « Corriger… », selon lequel des deux était actif — jamais
  // systématiquement le premier, sans quoi fermer une correction renvoie le
  // focus sur un bouton qui n'a jamais été activé. Sans cela le focus
  // retombe sur `<body>` et il faut retraverser toute la table des
  // paramètres à la tabulation.
  const boutonEvolution = useRef<HTMLButtonElement>(null);
  const boutonCorrection = useRef<HTMLButtonElement>(null);
  const modePrecedent = useRef<ModeFiche>(mode);
  useEffect(() => {
    if (modePrecedent.current !== 'consultation' && mode === 'consultation') {
      const cible =
        modePrecedent.current === 'evolution' ? boutonEvolution.current : boutonCorrection.current;
      cible?.focus();
    }
    modePrecedent.current = mode;
  }, [mode]);

  if (fiche === null) {
    return (
      <Panneau titre="Fiche du paramètre">
        <EtatVide
          variante="normal"
          texte="Sélectionnez un paramètre dans la liste pour voir son historique de versions et le faire évoluer."
        />
      </Panneau>
    );
  }

  return (
    // `key` sur la cle : changer de parametre remonte des formulaires vierges
    // plutot que de reafficher la saisie commencee sur le precedent.
    <Panneau key={fiche.cle} titre={fiche.cle} sansRembourrage>
      <div className="p-4">
        <p className="text-2xs uppercase text-ink-3">Valeur en vigueur aujourd'hui</p>
        <p className="mt-1 text-xl text-ink num">{valeurAffichee(fiche.enVigueur)}</p>
        <p className="mt-1 text-xs text-ink-3">
          Applicable depuis le {formaterDate(fiche.enVigueur.dateDebutValidite)} · type «{' '}
          {fiche.enVigueur.typeValeur} »
        </p>
        <p className="mt-2 text-sm text-ink-2">{fiche.enVigueur.description}</p>
      </div>

      {/* Filet pleine largeur et non un second panneau : docs/07 §4.8 plafonne
          l'imbrication de cartes a une profondeur de 1. */}
      <div className="border-t border-line p-4">
        <h3 className="text-2xs uppercase text-ink-3">
          Historique — {fiche.versions.length} version{fiche.versions.length > 1 ? 's' : ''}
        </h3>
        <ul className="mt-2 flex flex-col gap-groupe">
          {fiche.versions.map((version) => {
            const active = version.id === fiche.enVigueur.id;
            return (
              <li key={version.id} className="flex flex-col gap-1 text-sm">
                <div className="flex items-baseline justify-between gap-groupe">
                  <span className={active ? 'text-ink' : 'text-ink-3'}>
                    {/* Le mot porte l'information, pas la couleur seule : ces
                        ecrans partent en PDF noir et blanc (docs/07 §4.5). */}
                    {formaterDate(version.dateDebutValidite)}
                    {active ? ' — en vigueur' : ''}
                  </span>
                  <span className={`num ${active ? 'text-ink' : 'text-ink-3'}`}>
                    {valeurAffichee(version)}
                  </span>
                </div>
                <span className="text-xs text-ink-3">{version.source}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-line p-4">
        {mode === 'consultation' && (
          <div className="flex flex-col gap-groupe">
            {/* Deux actions NOMMEES, jamais un « Modifier » unique : le choix
                entre rectifier une erreur et acter un changement de loi est
                metier, et l'utilisateur seul peut le faire. */}
            <button
              type="button"
              ref={boutonEvolution}
              onClick={() => onChangerMode('evolution')}
              className={CLASSE_BOUTON_PRIMAIRE}
            >
              Faire évoluer à partir d'une date
            </button>
            <button
              type="button"
              ref={boutonCorrection}
              onClick={() => onChangerMode('correction')}
              className={CLASSE_BOUTON_SECONDAIRE}
            >
              Corriger la valeur en vigueur
            </button>
            <p className="text-xs text-ink-3">
              Faire évoluer ajoute une version datée et laisse le passé intact : c'est le geste d'un
              seuil légal qui change d'année. Corriger réécrit la valeur actuelle, y compris pour
              les sessions déjà clôturées : réservez-le à une faute de saisie.
            </p>
          </div>
        )}

        {mode === 'evolution' && (
          <FormulaireEvolution
            fiche={fiche}
            aujourdHui={aujourdHui}
            onAnnuler={() => onChangerMode('consultation')}
            onEcrit={onEcrit}
          />
        )}

        {mode === 'correction' && (
          <FormulaireCorrection
            fiche={fiche}
            onAnnuler={() => onChangerMode('consultation')}
            onEcrit={onEcrit}
          />
        )}
      </div>
    </Panneau>
  );
}

/* ═══ Formulaires ═══════════════════════════════════════════════════════════ */

type EtatEnvoi =
  | { statut: 'inactif' }
  | { statut: 'envoi' }
  | { statut: 'succes'; message: string }
  | { statut: 'erreur'; message: string };

/**
 * Efface le message de succes au bout de 5 s ; une erreur, elle, persiste
 * (docs/07 §4.7 : « une notification d'erreur qui disparait toute seule est un
 * bug »).
 */
function useEffacementSucces(envoi: EtatEnvoi, setEnvoi: (etat: EtatEnvoi) => void): void {
  useEffect(() => {
    if (envoi.statut !== 'succes') return undefined;
    const minuteur = window.setTimeout(() => setEnvoi({ statut: 'inactif' }), DELAI_SUCCES_MS);
    return () => window.clearTimeout(minuteur);
  }, [envoi, setEnvoi]);
}

/** Focalise le premier champ fautif (docs/07 §4.7), sans jamais vider la saisie. */
function focaliserPremierChampEnErreur(champs: ChampsEnErreur): void {
  const premier = Object.keys(champs)[0];
  if (premier === undefined) return;
  document.getElementById(premier)?.focus();
}

/**
 * Faire evoluer : nouvelle version datee.
 *
 * Le formulaire montre en permanence la valeur en vigueur et la date a laquelle
 * elle a pris effet, parce que la contrainte principale — la nouvelle version
 * doit demarrer APRES — n'est comprehensible que si cette date est sous les yeux.
 */
function FormulaireEvolution({
  fiche,
  aujourdHui,
  onAnnuler,
  onEcrit,
}: {
  fiche: Fiche;
  aujourdHui: string;
  onAnnuler: () => void;
  onEcrit: () => void;
}) {
  const [valeur, setValeur] = useState(fiche.enVigueur.valeur);
  const [dateDebutValidite, setDateDebutValidite] = useState('');
  const [source, setSource] = useState('');
  const [champs, setChamps] = useState<ChampsEnErreur>({});
  const [envoi, setEnvoi] = useState<EtatEnvoi>({ statut: 'inactif' });
  const premierChamp = useRef<HTMLInputElement>(null);

  useEffect(() => {
    premierChamp.current?.focus();
  }, []);

  useEffacementSucces(envoi, setEnvoi);

  async function soumettre(evenement: FormEvent<HTMLFormElement>): Promise<void> {
    evenement.preventDefault();
    setChamps({});
    setEnvoi({ statut: 'envoi' });

    try {
      await requeteApi(`/parametres/${encodeURIComponent(fiche.cle)}/versions`, {
        method: 'POST',
        body: JSON.stringify({
          valeur: normaliserValeurEnvoyee(valeur, fiche.enVigueur.typeValeur),
          dateDebutValidite,
          source,
        }),
      });
      setEnvoi({
        statut: 'succes',
        message: `Nouvelle version enregistrée, applicable à partir du ${formaterDate(dateDebutValidite)}.`,
      });
      setSource('');
      setDateDebutValidite('');
      onEcrit();
    } catch (erreur) {
      if (erreur instanceof ErreurApi && erreur.champs !== undefined) {
        setChamps(erreur.champs);
        focaliserPremierChampEnErreur(erreur.champs);
      }
      setEnvoi({
        statut: 'erreur',
        message:
          erreur instanceof ErreurApi ? erreur.message : "L'enregistrement de la version a échoué.",
      });
    }
  }

  return (
    <form onSubmit={(e) => void soumettre(e)} className="flex flex-col gap-bloc">
      <h3 className="text-2xs uppercase text-ink-3">Faire évoluer à partir d'une date</h3>
      <p className="text-xs text-ink-3">
        La valeur actuelle ({valeurAffichee(fiche.enVigueur)}) reste enregistrée et continuera
        d'être appliquée à toute période antérieure à la date choisie.
      </p>

      <EnveloppeChamp id="valeur" label="Nouvelle valeur" erreur={champs.valeur}>
        <input
          id="valeur"
          ref={premierChamp}
          type="text"
          required
          value={valeur}
          onChange={(e) => setValeur(e.target.value)}
          className={CLASSE_CHAMP}
        />
      </EnveloppeChamp>
      <p className="-mt-2 text-xs text-ink-3">{aideSaisie(fiche.enVigueur)}</p>

      <EnveloppeChamp
        id="dateDebutValidite"
        label="Entre en vigueur le"
        erreur={champs.dateDebutValidite}
      >
        <input
          id="dateDebutValidite"
          type="date"
          required
          // Borne basse native : la version courante a commence ce jour-la, la
          // suivante doit demarrer apres. Le serveur revalide de toute facon —
          // ceci evite seulement un aller-retour inutile.
          min={fiche.enVigueur.dateDebutValidite}
          value={dateDebutValidite}
          onChange={(e) => setDateDebutValidite(e.target.value)}
          className={CLASSE_CHAMP}
        />
      </EnveloppeChamp>
      <p className="-mt-2 text-xs text-ink-3">
        Version actuelle en vigueur depuis le {formaterDate(fiche.enVigueur.dateDebutValidite)}.
        Aujourd'hui : {formaterDate(aujourdHui)}.
      </p>

      <EnveloppeChamp id="source" label="Source du nouveau chiffre" erreur={champs.source}>
        <input
          id="source"
          type="text"
          required
          placeholder="ex. SPF Finances, seuil 2027"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className={CLASSE_CHAMP}
        />
      </EnveloppeChamp>

      <MessageEnvoi envoi={envoi} />

      <div className="flex justify-end gap-groupe">
        <button type="button" onClick={onAnnuler} className={CLASSE_BOUTON_SECONDAIRE}>
          Annuler
        </button>
        <button
          type="submit"
          disabled={envoi.statut === 'envoi'}
          className={CLASSE_BOUTON_PRIMAIRE}
        >
          {envoi.statut === 'envoi' ? 'Enregistrement…' : 'Enregistrer la version'}
        </button>
      </div>
    </form>
  );
}

/**
 * Corriger : rectification en place de la ligne en vigueur.
 *
 * L'avertissement n'est pas decoratif. Cette route reecrit la valeur pour TOUTE
 * la periode couverte par la version, y compris des sessions deja cloturees :
 * c'est legitime quand la valeur n'a jamais ete exacte, et destructeur sinon.
 */
function FormulaireCorrection({
  fiche,
  onAnnuler,
  onEcrit,
}: {
  fiche: Fiche;
  onAnnuler: () => void;
  onEcrit: () => void;
}) {
  const [valeur, setValeur] = useState(fiche.enVigueur.valeur);
  const [champs, setChamps] = useState<ChampsEnErreur>({});
  const [envoi, setEnvoi] = useState<EtatEnvoi>({ statut: 'inactif' });
  const premierChamp = useRef<HTMLInputElement>(null);

  useEffect(() => {
    premierChamp.current?.focus();
  }, []);

  useEffacementSucces(envoi, setEnvoi);

  async function soumettre(evenement: FormEvent<HTMLFormElement>): Promise<void> {
    evenement.preventDefault();
    setChamps({});
    setEnvoi({ statut: 'envoi' });

    try {
      await requeteApi(`/parametres/${fiche.enVigueur.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          valeur: normaliserValeurEnvoyee(valeur, fiche.enVigueur.typeValeur),
        }),
      });
      setEnvoi({
        statut: 'succes',
        message: 'Valeur corrigée. La correction est tracée au journal.',
      });
      onEcrit();
    } catch (erreur) {
      if (erreur instanceof ErreurApi && erreur.champs !== undefined) {
        setChamps(erreur.champs);
        focaliserPremierChampEnErreur(erreur.champs);
      }
      setEnvoi({
        statut: 'erreur',
        message: erreur instanceof ErreurApi ? erreur.message : 'La correction a échoué.',
      });
    }
  }

  return (
    <form onSubmit={(e) => void soumettre(e)} className="flex flex-col gap-bloc">
      <h3 className="text-2xs uppercase text-ink-3">Corriger la valeur en vigueur</h3>
      <p className="text-xs text-ink-3">
        À n'utiliser que si la valeur enregistrée est erronée depuis le début. La correction
        s'applique rétroactivement à la période du {formaterDate(fiche.enVigueur.dateDebutValidite)}
        , donc aux sessions déjà clôturées. Pour un chiffre qui change à une date, utilisez « Faire
        évoluer ».
      </p>

      <EnveloppeChamp id="valeur" label="Valeur corrigée" erreur={champs.valeur}>
        <input
          id="valeur"
          ref={premierChamp}
          type="text"
          required
          value={valeur}
          onChange={(e) => setValeur(e.target.value)}
          className={CLASSE_CHAMP}
        />
      </EnveloppeChamp>
      <p className="-mt-2 text-xs text-ink-3">{aideSaisie(fiche.enVigueur)}</p>

      <MessageEnvoi envoi={envoi} />

      <div className="flex justify-end gap-groupe">
        <button type="button" onClick={onAnnuler} className={CLASSE_BOUTON_SECONDAIRE}>
          Annuler
        </button>
        <button
          type="submit"
          disabled={envoi.statut === 'envoi'}
          className={CLASSE_BOUTON_PRIMAIRE}
        >
          {envoi.statut === 'envoi' ? 'Correction…' : 'Corriger'}
        </button>
      </div>
    </form>
  );
}

/* ═══ Briques partagees par les deux formulaires ════════════════════════════ */

/**
 * Rappelle l'unite REELLEMENT stockee. Un utilisateur qui lit « 25 000,00 € »
 * dans la liste saisirait spontanement `25000` la ou la base attend `2500000` :
 * les montants sont en centimes entiers (CLAUDE.md §3 regle 3) et les taux en
 * points de base. Sans ce rappel sous le champ, l'erreur est certaine.
 */
function aideSaisie(version: Parametre): string {
  if (version.cle.endsWith('_cents')) {
    return 'En centimes d’euro, en nombre entier : 2500000 pour 25 000,00 €.';
  }
  if (version.cle.endsWith('_bp')) {
    return 'En points de base, en nombre entier : 169 pour 1,69 %.';
  }
  switch (version.typeValeur) {
    case 'entier':
      return 'Nombre entier, sans virgule ni séparateur de milliers.';
    case 'decimal':
      return 'Nombre décimal : la virgule et le point sont acceptés (1,28 ou 1.28).';
    case 'booleen':
      return 'Saisissez « true » ou « false ».';
    case 'json':
      return 'JSON valide.';
    default:
      return 'Texte libre.';
  }
}

/**
 * Un paramètre `decimal` est saisi en français belge (virgule) comme partout
 * ailleurs dans l'application (`parserEuros`, `nombreSaisi`) mais stocké avec
 * un point (CLAUDE.md §3, cohérence de format). Les autres types (`entier`,
 * `booleen`, `json`, `texte`) ne subissent AUCUNE transformation : un JSON
 * peut légitimement contenir une virgule, la remplacer par un point le
 * corromprait.
 */
function normaliserValeurEnvoyee(valeur: string, typeValeur: Parametre['typeValeur']): string {
  return typeValeur === 'decimal' ? valeur.trim().replace(',', '.') : valeur;
}

function MessageEnvoi({ envoi }: { envoi: EtatEnvoi }) {
  if (envoi.statut === 'succes') {
    return (
      <p role="status" className="text-sm text-conforme">
        {envoi.message}
      </p>
    );
  }
  if (envoi.statut === 'erreur') {
    // Catch-all d'un formulaire dont les champs fautifs portent DÉJÀ leur
    // propre message en ligne, en registre d'alerte, et reçoivent le focus
    // (`focaliserPremierChampEnErreur`). Ce qui reste ici est soit la phrase
    // générique qui accompagne ces champs, soit une panne — dans les deux cas,
    // rien qui mérite de crier une seconde fois par-dessus.
    return <MessageErreur message={envoi.message} />;
  }
  return null;
}
