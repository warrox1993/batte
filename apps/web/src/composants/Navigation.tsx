import { useLayoutEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

type ElementNavigation = {
  libelle: string;
  chemin: string;
};

type GroupeNavigation = {
  /** `null` = pas d'en-tete de groupe (cas de Parametres, isole en bas de nav). */
  titre: string | null;
  elements: ElementNavigation[];
};

/**
 * Structure et ordre figes par docs/06-UI-ET-PARCOURS.md : « l'ordre reflete
 * la frequence d'usage reelle, pas une logique d'entites ». Ne pas reordonner
 * ni regrouper autrement sans mettre a jour ce document.
 */
const GROUPES: readonly GroupeNavigation[] = [
  {
    titre: 'Pilotage',
    elements: [
      { libelle: 'Tableau de bord', chemin: '/' },
      { libelle: 'Prochaine session', chemin: '/prochaine-session' },
      { libelle: 'Besoins projetés', chemin: '/prevision-calendaire' },
    ],
  },
  {
    titre: 'Exploitation',
    elements: [
      { libelle: 'Production', chemin: '/production' },
      { libelle: 'Sessions', chemin: '/sessions' },
      { libelle: 'Stock', chemin: '/stock' },
      { libelle: 'Achats', chemin: '/achats' },
    ],
  },
  {
    titre: 'Référentiel',
    elements: [
      // L'ordre suit la chaine de donnees : ce qu'on achete, puis ce qu'on en fait.
      { libelle: 'Ingrédients', chemin: '/ingredients' },
      { libelle: 'Recettes', chemin: '/recettes' },
      { libelle: 'Produits', chemin: '/produits' },
      { libelle: 'Nomenclature de vente', chemin: '/nomenclature-vente' },
      { libelle: 'Menus', chemin: '/menus' },
      { libelle: 'Fournisseurs', chemin: '/fournisseurs' },
      { libelle: 'Événements', chemin: '/evenements' },
      { libelle: 'Concurrents', chemin: '/concurrents' },
      { libelle: 'Propositions IA (événements)', chemin: '/evenements-decouverte' },
      { libelle: 'Lieux de marché', chemin: '/lieux' },
      { libelle: 'Équipements', chemin: '/equipements' },
    ],
  },
  {
    titre: 'Contrôle',
    elements: [
      { libelle: 'Comptabilité', chemin: '/comptabilite' },
      { libelle: 'Comparaison des lieux', chemin: '/comparaison-lieux' },
      { libelle: 'Où aller ?', chemin: '/opportunites' },
      { libelle: 'Objectifs et succès', chemin: '/objectifs' },
      // Juste apres la comptabilite : une economie d'achat REDUIT le cout
      // matiere, c'est une lecture de la meme famille (fiche 12).
      { libelle: "Économies d'achat", chemin: '/economies' },
      { libelle: 'Factures fournisseur', chemin: '/factures' },
      { libelle: 'Registre AFSCA', chemin: '/registre-afsca' },
      { libelle: 'Qualité du modèle', chemin: '/qualite-modele' },
      // Meme famille que le journal d'audit : on l'ouvre pour VERIFIER, pas pour
      // travailler. Le plafond mensuel et le journal des appels sont exiges par
      // CLAUDE.md §5 ; ils existaient cote serveur sans qu'aucun ecran ne les
      // montre, donc un plafond qu'on ne decouvrait qu'au moment ou il coupait.
      { libelle: 'Assistance IA', chemin: '/assistance-ia' },
      // Dernier du groupe : c'est l'ecran le moins frequent, et docs/06 ordonne
      // par frequence reelle d'usage.
      { libelle: "Journal d'audit", chemin: '/journal-audit' },
    ],
  },
  {
    titre: null,
    elements: [{ libelle: 'Paramètres', chemin: '/parametres' }],
  },
];

/**
 * Lien d'evitement (WCAG 2.4.1 « Bypass Blocks », niveau A).
 *
 * Mesure au clavier avant correction : 13 tabulations pour traverser la
 * navigation avant d'atteindre le premier controle du contenu, sur CHAQUE
 * ecran et a chaque chargement. Sur la saisie post-marche — repetitive, au
 * clavier, le dimanche soir (CLAUDE.md §3 regle 10) — c'est un cout reel.
 *
 * C'est un `<button>` et non un `<a href="#...">` parce que le `<main>` de
 * `App.tsx` ne porte pas d'`id`. On deplace donc le focus par script : la
 * technique WCAG vise la FONCTION (atteindre le contenu), pas l'element.
 * `tabIndex = -1` est pose au moment du clic — un conteneur non focalisable
 * ne peut pas recevoir le focus, et le poser en dur laisserait un element
 * atteignable au clic sans raison.
 */
function LienEvitement() {
  return (
    <button
      type="button"
      onClick={() => {
        const contenu = document.querySelector('main');
        if (contenu === null) return;
        contenu.tabIndex = -1;
        contenu.focus();
      }}
      // Hors flux et hors ecran tant qu'il n'a pas le focus : il ne doit
      // deplacer aucun pixel de la navigation quand il est inactif.
      className="absolute left-2 top-2 z-10 flex h-controle -translate-y-16 items-center rounded-sm bg-accent px-3 text-sm font-medium text-on-accent opacity-0 focus-visible:translate-y-0 focus-visible:opacity-100"
    >
      Aller au contenu
    </button>
  );
}

/**
 * Barre laterale fixe, jamais retractable (docs/06). Composee d'elements
 * `NavLink` natifs : focus et activation au clavier fonctionnent sans code
 * supplementaire.
 *
 * L'etat actif n'est PAS un aplat `bg-accent` plein : docs/07 §4.1 releve
 * que c'est le defaut le plus visible de la version precedente, l'accent
 * saturant l'element le plus visible de l'ecran alors qu'il doit rester
 * reserve a l'action primaire et aux statuts. A la place : fond sunken,
 * encre pleine, et une simple barre d'accent de 2 px a gauche.
 *
 * 29 entrees ne tiennent pas dans les ~720 px utiles a 1280x720 (mission du
 * 31/07/2026, chiffres au navigateur) : la nav deborde de 252 px et 8 entrees
 * restent sous le pli. Mesure et assume — voir le rapport de mission pour
 * l'arbitrage complet — SAUF un point corrige ici : sans le `useLayoutEffect`
 * ci-dessous, atterrir directement (lien externe, actualisation, retour
 * arriere) sur une des 8 entrees sous le pli laissait un menu ou rien
 * n'apparaissait selectionne, precisement sur les ecrans les moins
 * frequentes ou l'utilisateur a le moins ses reperes.
 */
export function Navigation() {
  const conteneurRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  // Ramene l'entree active dans le champ visible a chaque changement de
  // route (y compris le montage initial, `pathname` etant deja defini au
  // premier rendu). `useLayoutEffect` plutot que `useEffect` : le repositionnement
  // doit avoir eu lieu AVANT la premiere peinture, sinon l'oeil voit le menu
  // non-scrolle puis un saut. `block: 'nearest'` + comportement par defaut
  // (donc instantane, jamais 'smooth') : le plus petit deplacement possible,
  // sans animation — docs/07 interdit le rebond elastique, et un saut anime
  // ne serait pas plus juste qu'un saut instantane pour ce cas ponctuel.
  // Aucun effet quand l'entree active est deja visible (clic sur un lien
  // deja a l'ecran) : `scrollIntoView` ne bouge rien dans ce cas.
  useLayoutEffect(() => {
    const actif = conteneurRef.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    actif?.scrollIntoView({ block: 'nearest' });
  }, [pathname]);

  return (
    <nav
      ref={conteneurRef}
      aria-label="Navigation principale"
      className="flex h-full w-nav shrink-0 flex-col overflow-y-auto border-r border-line-strong bg-surface py-3"
    >
      <LienEvitement />
      {GROUPES.map((groupe, index) => (
        // Le seul groupe sans titre (Parametres) est aussi le seul en position
        // fixe : l'index suffit comme cle, la liste GROUPES ne se reordonne jamais.
        <div key={groupe.titre ?? `groupe-${index}`} className={index === 0 ? 'px-2' : 'mt-4 px-2'}>
          {groupe.titre !== null && (
            <h2 className="mb-1 px-2 text-2xs uppercase text-ink-3">{groupe.titre}</h2>
          )}
          <ul>
            {groupe.elements.map((element) => (
              <li key={element.chemin}>
                <NavLink
                  to={element.chemin}
                  end={element.chemin === '/'}
                  className={({ isActive }) =>
                    [
                      'relative flex h-7 items-center rounded-sm px-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                      isActive
                        ? 'bg-surface-sunken font-medium text-ink'
                        : 'text-ink-2 hover:bg-surface-sunken',
                    ].join(' ')
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 w-0.5 bg-accent"
                        />
                      )}
                      {element.libelle}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
