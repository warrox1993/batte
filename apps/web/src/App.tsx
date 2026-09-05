import { Route, Routes } from 'react-router-dom';
import { Navigation } from './composants/Navigation';
import { EtatVide } from './composants/EtatVide';
import TableauDeBord from './pages/TableauDeBord';
import ProchaineSession from './pages/ProchaineSession';
import Production from './pages/Production';
import Sessions from './pages/Sessions';
import Stock from './pages/Stock';
import InventaireInitial from './pages/InventaireInitial';
import Achats from './pages/Achats';
import Recettes from './pages/Recettes';
import Produits from './pages/Produits';
import Fournisseurs from './pages/Fournisseurs';
import Evenements from './pages/Evenements';
import ComparaisonLieux from './pages/ComparaisonLieux';
import Comptabilite from './pages/Comptabilite';
import Concurrents from './pages/Concurrents';
import PropositionsEvenements from './pages/PropositionsEvenements';
import RegistreAfsca from './pages/RegistreAfsca';
import QualiteModele from './pages/QualiteModele';
import Economies from './pages/Economies';
import Equipements from './pages/Equipements';
import Factures from './pages/Factures';
import NomenclatureVente from './pages/NomenclatureVente';
import Menus from './pages/Menus';
import Objectifs from './pages/Objectifs';
import Opportunites from './pages/Opportunites';
import PrevisionCalendaire from './pages/PrevisionCalendaire';
import JournalAudit from './pages/JournalAudit';
import AssistanceIa from './pages/AssistanceIa';
import Ingredients from './pages/Ingredients';
import LieuxMarche from './pages/LieuxMarche';
import Parametres from './pages/Parametres';

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
      </main>
    </div>
  );
}
