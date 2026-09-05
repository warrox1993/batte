/**
 * Etats vides explicites et reutilisables.
 *
 * docs/07-DOCTRINE-ERP-ET-DESIGN.md §4.7 exige QUATRE cas visuellement et
 * textuellement distincts, jamais un seul gabarit generique :
 *
 *  - `premier-lancement` : titre en enonce positif + une phrase de contexte
 *    + une action primaire optionnelle.
 *  - `filtre`             : dit QUEL filtre exclut, propose la reinitialisation.
 *    Ne reutilise jamais le texte du premier lancement.
 *  - `normal`              : une ligne discrete (« Aucune alerte. »), jamais
 *    une carte avec titre et bouton.
 *  - `lot-a-venir`         : ecran pas encore construit (docs/04-ROADMAP-LOTS.md).
 *    Liseré `alerte` pour qu'on ne livre jamais un ecran incomplet en le
 *    croyant termine.
 *
 * Un seul composant, un type discriminant par `variante` : impossible d'passer
 * les props d'un cas dans un autre par erreur (pas de props optionnelles qui
 * se substituent silencieusement les unes aux autres).
 */

type ActionEtatVide = {
  libelle: string;
  onClick: () => void;
};

/**
 * Niveau du titre de l'etat vide.
 *
 * Par defaut `h3` : un etat vide s'affiche presque toujours DANS le corps d'un
 * `Panneau`, dont le titre est deja un `h2`. Emettre un second `h2` au meme
 * niveau ferait lire a un lecteur d'ecran deux sections soeurs la ou il n'y a
 * qu'une section et son contenu.
 *
 * `h2` reste disponible pour les rares ecrans ou l'etat vide est pose seul
 * sous le `h1` de la page (les placeholders `Produits`, `Fournisseurs`,
 * `InventaireInitial`) : la, `h3` sauterait un niveau.
 */
type NiveauTitre = 'h2' | 'h3';

type EtatVidePremierLancement = {
  variante: 'premier-lancement';
  titre: string;
  explication: string;
  action?: ActionEtatVide;
  niveauTitre?: NiveauTitre;
};

type EtatVideFiltre = {
  variante: 'filtre';
  /** Doit nommer le filtre en cause, ex. « Le filtre "à commander" masque les 14 autres ingrédients. » */
  explicationFiltre: string;
  onReinitialiser: () => void;
};

type EtatVideNormal = {
  variante: 'normal';
  /** Une phrase courte, ex. « Aucune alerte. » */
  texte: string;
};

type EtatVideLotAVenir = {
  variante: 'lot-a-venir';
  titre: string;
  explication: string;
  niveauTitre?: NiveauTitre;
};

export type EtatVideProps =
  EtatVidePremierLancement | EtatVideFiltre | EtatVideNormal | EtatVideLotAVenir;

function BoutonAction({ action }: { action: ActionEtatVide }) {
  return (
    <button
      type="button"
      onClick={action.onClick}
      className="mt-3 h-controle rounded-sm bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {action.libelle}
    </button>
  );
}

export function EtatVide(props: EtatVideProps) {
  switch (props.variante) {
    case 'premier-lancement': {
      const Titre = props.niveauTitre ?? 'h3';
      return (
        <div className="rounded-md border border-line-strong bg-surface px-4 py-6">
          <Titre className="text-sm font-semibold text-ink">{props.titre}</Titre>
          <p className="mt-1 text-sm text-ink-2">{props.explication}</p>
          {props.action !== undefined && <BoutonAction action={props.action} />}
        </div>
      );
    }

    case 'filtre':
      return (
        <div className="px-4 py-6 text-sm text-ink-2">
          <p>{props.explicationFiltre}</p>
          <button
            type="button"
            onClick={props.onReinitialiser}
            className="mt-2 text-sm font-medium text-accent hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Réinitialiser le filtre
          </button>
        </div>
      );

    case 'normal':
      return <p className="px-4 py-2 text-sm text-ink-3">{props.texte}</p>;

    case 'lot-a-venir': {
      const Titre = props.niveauTitre ?? 'h3';
      return (
        <div className="rounded-md border-y border-r border-line-strong border-l-2 border-l-alerte bg-surface px-4 py-6">
          <Titre className="text-sm font-semibold text-ink">{props.titre}</Titre>
          <p className="mt-1 text-sm text-ink-2">{props.explication}</p>
        </div>
      );
    }
  }
}
