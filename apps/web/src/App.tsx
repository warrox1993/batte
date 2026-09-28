import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Navigation } from './composants/Navigation';
import { EtatVide } from './composants/EtatVide';
import TableauDeBord from './pages/TableauDeBord';

/*
 * Découpage du bundle (28/09/2026) : un seul bloc JS de 1,47 Mo était chargé
 * au premier affichage, quel que soit l'écran demandé. Le tableau de bord,
 * écran d'accueil, reste importé normalement ; chaque autre écran est chargé
 * à la demande (`React.lazy` + import dynamique), dans son propre fichier.
 * Rien ne change dans les écrans eux-mêmes : seul le moment de leur
 * téléchargement bouge.
 */
const ProchaineSession = lazy(() => import('./pages/ProchaineSession'));
const Production = lazy(() => import('./pages/Production'));
const Sessions = lazy(() => import('./pages/Sessions'));
const Stock = lazy(() => import('./pages/Stock'));
const InventaireInitial = lazy(() => import('./pages/InventaireInitial'));
const Achats = lazy(() => import('./pages/Achats'));
const Recettes = lazy(() => import('./pages/Recettes'));
const Produits = lazy(() => import('./pages/Produits'));
const Fournisseurs = lazy(() => import('./pages/Fournisseurs'));
const Evenements = lazy(() => import('./pages/Evenements'));
const ComparaisonLieux = lazy(() => import('./pages/ComparaisonLieux'));
const Comptabilite = lazy(() => import('./pages/Comptabilite'));
const Concurrents = lazy(() => import('./pages/Concurrents'));
const PropositionsEvenements = lazy(() => import('./pages/PropositionsEvenements'));
const RegistreAfsca = lazy(() => import('./pages/RegistreAfsca'));
const QualiteModele = lazy(() => import('./pages/QualiteModele'));
const Economies = lazy(() => import('./pages/Economies'));
const Equipements = lazy(() => import('./pages/Equipements'));
const Factures = lazy(() => import('./pages/Factures'));
const NomenclatureVente = lazy(() => import('./pages/NomenclatureVente'));
const Menus = lazy(() => import('./pages/Menus'));
const Objectifs = lazy(() => import('./pages/Objectifs'));
const Opportunites = lazy(() => import('./pages/Opportunites'));
const PrevisionCalendaire = lazy(() => import('./pages/PrevisionCalendaire'));
const JournalAudit = lazy(() => import('./pages/JournalAudit'));
const AssistanceIa = lazy(() => import('./pages/AssistanceIa'));
const Ingredients = lazy(() => import('./pages/Ingredients'));
const LieuxMarche = lazy(() => import('./pages/LieuxMarche'));
const Parametres = lazy(() => import('./pages/Parametres'));

/** Affiché le temps de télécharger le fichier d'un écran (local : quelques ms). */
function ChargementEcran() {
  return (
    <p role="status" className="text-sm text-ink-3">
      Chargement de l’écran…
    </p>
  );
}

/**
 * Mise en page generale : barre laterale fixe + zone de contenu defilante.
 * La navigation ne se replie jamais (docs/06-UI-ET-PARCOURS.md).
 *
 * Chassis en jetons semantiques uniquement (docs/07 §4.9 : aucune couleur
 * Tailwind brute, seulement les jetons `bg-canvas`, `text-ink-2`, etc.).
 * Chaque ecran routé applique en
 * plus le gabarit impose par docs/07 §4.4 : une ligne de titre de 32 px,
 * suivie du contenu — jamais de grand titre de page, la hauteur etant la
 * ressource rare a 1280x720. La barre d'outils de 40 px (action primaire en
 * haut a droite) s'ajoutera ecran par ecran a mesure qu'une action primaire
 * existera : aucune des pages actuelles n'en a une, et une barre vide serait
 * du chrome sans fonction (docs/07 §2.1 : « section vide -> masquee »).
 */
export default function App() {
  return (
    <div className="flex h-screen bg-canvas text-ink-2">
      <Navigation />
      <main className="flex-1 overflow-y-auto p-bloc">
        <Suspense fallback={<ChargementEcran />}>
          <Routes>
            <Route path="/" element={<TableauDeBord />} />
            <Route path="/prochaine-session" element={<ProchaineSession />} />
            <Route path="/production" element={<Production />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/stock" element={<Stock />} />
            <Route path="/stock/inventaire" element={<InventaireInitial />} />
            <Route path="/achats" element={<Achats />} />
            <Route path="/recettes" element={<Recettes />} />
            <Route path="/produits" element={<Produits />} />
            <Route path="/fournisseurs" element={<Fournisseurs />} />
            <Route path="/evenements" element={<Evenements />} />
            <Route path="/comptabilite" element={<Comptabilite />} />
            <Route path="/comparaison-lieux" element={<ComparaisonLieux />} />
            <Route path="/concurrents" element={<Concurrents />} />
            <Route path="/evenements-decouverte" element={<PropositionsEvenements />} />
            <Route path="/registre-afsca" element={<RegistreAfsca />} />
            <Route path="/qualite-modele" element={<QualiteModele />} />
            <Route path="/economies" element={<Economies />} />
            <Route path="/equipements" element={<Equipements />} />
            <Route path="/factures" element={<Factures />} />
            <Route path="/nomenclature-vente" element={<NomenclatureVente />} />
            <Route path="/menus" element={<Menus />} />
            <Route path="/objectifs" element={<Objectifs />} />
            <Route path="/opportunites" element={<Opportunites />} />
            <Route path="/prevision-calendaire" element={<PrevisionCalendaire />} />
            <Route path="/assistance-ia" element={<AssistanceIa />} />
            <Route path="/journal-audit" element={<JournalAudit />} />
            <Route path="/ingredients" element={<Ingredients />} />
            <Route path="/lieux" element={<LieuxMarche />} />
            <Route path="/parametres" element={<Parametres />} />
            <Route
              path="*"
              element={
                <EtatVide
                  variante="premier-lancement"
                  titre="Page introuvable"
                  explication="Cette adresse ne correspond à aucun écran de l'application. Utilisez la navigation à gauche."
                />
              }
            />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
