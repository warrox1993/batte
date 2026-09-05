import { useRef, useState } from 'react';
import { ErreurApi, telechargerFichierApi, type FichierRecu } from '../lib/api';
import { MessageErreur, natureDuRefus, type NatureRefus } from './EncartErreur';

/**
 * Bouton d'edition d'un document (PDF ou Excel).
 *
 * L'application sait produire une famille de documents ; aucun n'etait
 * atteignable depuis l'interface avant ce composant. Il en existe UN SEUL
 * exemplaire pour tous les boutons du produit — la logique de telechargement,
 * l'attente, l'erreur et le nommage ne se recopient pas.
 *
 * Mesure du 01/08/2026 : 13 routes servant un document (six sous
 * `/documents/`, cinq sous `/exports/`, plus `/commandes/:id/pdf` et
 * `/prevision/brief` — les deux qui echappent a un balayage par prefixe),
 * pour 13 instanciations de ce composant reparties sur 10 ecrans.
 *
 * ═══ Pourquoi l'attente n'est pas du confort ═══
 *
 * D-026 : chaque appel ARCHIVE une nouvelle version numerotee du document, avec
 * son empreinte SHA-256 et l'instantane des donnees sources. C'est ce qui
 * permet d'affirmer devant un controle AFSCA que le fichier presente est bien
 * celui emis a telle date. Consequence directe : un double-clic ne « regenere »
 * pas, il ARCHIVE DEUX VERSIONS. Or un PDF passe par Playwright et prend
 * plusieurs secondes, donc sans retour visuel l'utilisateur reclique.
 *
 * Le bouton est donc inerte pendant la generation, et il l'annonce.
 *
 * ═══ Pourquoi `aria-disabled` et non `disabled` ═══
 *
 * Un `<button disabled>` qui a le focus le PERD au moment ou il se desactive :
 * le focus retombe sur `<body>`, et l'utilisateur au clavier — regle n°10 de
 * CLAUDE.md — se retrouve nulle part au milieu de son geste, sans savoir ou
 * revenir quand le bouton redevient actif. `aria-disabled` conserve le focus et
 * annonce l'indisponibilite ; l'inertie reelle vient du garde-fou dans le
 * gestionnaire, pas de l'attribut. C'est le motif recommande par l'ARIA
 * Authoring Practices pour un bouton qui doit rester atteignable.
 *
 * Corollaire utile : un bouton indisponible qu'on active DIT POURQUOI au lieu
 * de ne rien faire (docs/07 §0, « ne jamais faire sentir l'utilisateur idiot »).
 */

type VarianteBouton = 'primaire' | 'secondaire';

type EtatDocument =
  | { statut: 'inactif' }
  | { statut: 'en_cours' }
  | { statut: 'erreur'; message: string; nature: NatureRefus };

type BoutonDocumentProps = {
  /**
   * Chemin de la route SANS le prefixe `/api`, parametres de requete compris.
   * Exemple : `/documents/registre-afsca?periode=2026-06`.
   */
  readonly chemin: string;
  readonly libelle: string;
  /** Libelle affiche pendant la generation. « Édition… » par defaut. */
  readonly libelleAttente?: string;
  readonly variante?: VarianteBouton;
  /**
   * Raison, en francais, pour laquelle le document ne peut pas etre edite
   * MAINTENANT — session non cloturee, periode non saisie. Le bouton reste
   * visible et atteignable au clavier, mais inerte, et il rend cette phrase si
   * on l'active quand meme. Absent = le document est editable.
   */
  readonly raisonIndisponible?: string;
  /** Classes de mise en page ajoutees par l'ecran appelant (largeur, marge). */
  readonly className?: string;
};

/**
 * Jetons semantiques uniquement (docs/07 §4.9) : aucune couleur Tailwind brute.
 *
 * Ces deux chaines dupliquent volontairement celles de `saisie-stock/champs`.
 * `composants/` est la couche feuille du produit — rien n'y importe d'un
 * dossier metier — et l'inverser pour economiser deux constantes creerait une
 * dependance `composants/ -> saisie-stock/` que le prochain composant partage
 * heriterait sans raison.
 */
const CLASSE_COMMUNE =
  'inline-flex h-controle items-center justify-center rounded-sm px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const CLASSE_PAR_VARIANTE: Readonly<Record<VarianteBouton, string>> = {
  primaire: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondaire: 'border border-line-field bg-surface text-ink-2 hover:bg-surface-sunken',
};

/** Aspect « inerte », applique aussi bien a l'attente qu'a l'indisponibilite. */
const CLASSE_INERTE = 'cursor-not-allowed opacity-60';

/**
 * Delai avant liberation de l'URL objet.
 *
 * Revoquer dans la foulee du clic annule le telechargement sur certains
 * navigateurs : la ressource disparait avant que la couche de telechargement
 * ne l'ait lue. Une seconde suffit largement et ne retient qu'un blob.
 */
const DELAI_LIBERATION_URL_MS = 1000;

/**
 * Remet le fichier au navigateur, qui l'ecrit dans le dossier de
 * telechargement sous le nom donne par le serveur.
 *
 * Pourquoi pas `window.open` sur la route : parce qu'on ne saurait alors ni
 * afficher une attente, ni lire le message d'erreur du serveur (le navigateur
 * afficherait le JSON brut d'un 422 dans un onglet). L'appel passe donc par
 * `fetch`, et c'est ici qu'on rend le resultat a l'utilisateur.
 */
function remettreAuNavigateur(fichier: FichierRecu): void {
  const url = URL.createObjectURL(fichier.contenu);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = fichier.nomFichier;
  // L'ancre doit appartenir au document pour que le clic synthetique compte
  // sur Firefox — un `click()` sur un noeud detache y est ignore.
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), DELAI_LIBERATION_URL_MS);
}

/**
 * Choisit, dans une erreur d'API, la phrase qui dit a l'utilisateur QUOI FAIRE.
 *
 * Les routes de documents rendent deux formes de 422 :
 *
 *  - une erreur METIER, dont `message` est deja la phrase utile
 *    (« Aucun produit actif : l'affichette serait vide. Activez au moins un
 *    produit de la carte avant de l'éditer. ») ;
 *  - une erreur de VALIDATION, dont `message` ne vaut rien (« La saisie
 *    contient des champs invalides. ») et dont tout le contenu est dans
 *    `champs` (« Exercice trop ancien : indiquez une année à partir de
 *    2000. »).
 *
 * Afficher `message` dans les deux cas — ce que faisait la premiere version de
 * ce composant, mesure a l'ecran — reduit le second a un constat d'echec sans
 * remede. On prefere donc le detail quand il existe.
 *
 * Exportee pour etre testee : c'est une regle de presentation qui a deja ete
 * fausse une fois, et rien d'autre dans le rendu ne la couvrirait.
 */
export function messageActionnable(erreur: ErreurApi): string {
  const details = Object.values(erreur.champs ?? {});
  return details.length === 0 ? erreur.message : details.join(' ');
}

export function BoutonDocument({
  chemin,
  libelle,
  libelleAttente = 'Édition…',
  variante = 'secondaire',
  raisonIndisponible,
  className,
}: BoutonDocumentProps) {
  const [etat, setEtat] = useState<EtatDocument>({ statut: 'inactif' });
  /**
   * Verrou SYNCHRONE du garde-fou D-026.
   *
   * `etat.statut === 'en_cours'` ne suffit pas, et la mesure l'a montre : un
   * double-clic reel a envoye DEUX requetes, donc archive DEUX versions. La
   * raison est que `setEtat` est asynchrone — les deux clics sont traites par
   * la MEME cloture de rendu, celle ou l'etat vaut encore `inactif`, avant que
   * React n'ait recommite quoi que ce soit. Une `ref` est ecrite et relue dans
   * le meme tour de boucle : le second clic voit le verrou pose.
   */
  const verrou = useRef(false);

  const enCours = etat.statut === 'en_cours';
  const inerte = enCours || raisonIndisponible !== undefined;

  async function editer(): Promise<void> {
    if (verrou.current) return;

    if (raisonIndisponible !== undefined) {
      // Toujours METIER : cette raison est une condition d'exploitation non
      // remplie, jamais une panne — elle est calculee a l'ecran, sans reseau.
      setEtat({ statut: 'erreur', message: raisonIndisponible, nature: 'metier' });
      return;
    }

    verrou.current = true;
    setEtat({ statut: 'en_cours' });
    try {
      remettreAuNavigateur(await telechargerFichierApi(chemin));
      setEtat({ statut: 'inactif' });
    } catch (erreur) {
      // CLAUDE.md §4 : jamais de `catch` silencieux.
      setEtat({
        statut: 'erreur',
        message:
          erreur instanceof ErreurApi
            ? messageActionnable(erreur)
            : "L'édition du document a échoué, sans plus de détail.",
        nature: natureDuRefus(erreur),
      });
    } finally {
      // `finally` et non une ligne par branche : une erreur ne doit pas laisser
      // le bouton verrouille a vie, sans quoi il faudrait recharger l'ecran.
      verrou.current = false;
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-groupe">
      <button
        type="button"
        onClick={() => void editer()}
        aria-disabled={inerte}
        aria-busy={enCours}
        {...(raisonIndisponible !== undefined ? { title: raisonIndisponible } : {})}
        className={`${CLASSE_COMMUNE} ${CLASSE_PAR_VARIANTE[variante]} ${
          inerte ? CLASSE_INERTE : ''
        } ${className ?? ''}`}
      >
        {enCours ? libelleAttente : libelle}
      </button>

      {etat.statut === 'erreur' &&
        // `max-w` dans les deux cas : un message de 422 fait deux lignes et ne
        // doit pas etendre la barre d'outils qui le contient au-dela de la
        // largeur utile.
        (etat.nature === 'metier' ? (
          <span
            role="alert"
            className="max-w-[26rem] border-l-2 border-depassement bg-depassement-bg px-2 py-1 text-xs text-depassement"
          >
            {etat.message}
          </span>
        ) : (
          <span className="max-w-[26rem]">
            <MessageErreur message={etat.message} />
          </span>
        ))}
    </span>
  );
}
