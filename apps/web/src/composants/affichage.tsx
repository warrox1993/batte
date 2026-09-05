import { GLYPHE_STATUT, type Statut } from '@batte/core';

/**
 * Primitives d'AFFICHAGE partagées — elles ne saisissent rien, elles montrent.
 *
 * ═══ Pourquoi ce fichier existe (01/08/2026) ═══
 *
 * `PastilleStatut` existait en **sept exemplaires** (`Achats`, `Comptabilite`,
 * `Factures`, `Production`, `RegistreAfsca`, `Sessions`, `Stock`) et
 * `LigneFiche` en deux (`Ingredients`, `Recettes`). Mesuré par empreinte :
 * six des sept `PastilleStatut` étaient **rigoureusement identiques**, la
 * septième (`Factures`) ne différant que par un ternaire en ligne là où les
 * autres lisaient une table — même sortie, autre écriture.
 *
 * Ce n'est pas une économie de lignes : c'est un seul endroit où un défaut
 * peut revenir. Le 01/08/2026, un correctif d'ergonomie sur les champs de
 * formulaire a dû être appliqué SEPT fois pour la même raison, et cinq écrans
 * ont continué de porter le défaut sans que rien ne le signale.
 *
 * Règle d'architecture n°1 (CLAUDE.md §3) : aucun calcul métier ici.
 */

const CLASSE_TEXTE_STATUT: Readonly<Record<Statut, string>> = {
  depassement: 'text-depassement',
  alerte: 'text-alerte',
  conforme: 'text-conforme',
};

/**
 * Pastille glyphe + couleur (docs/07 §4.5).
 *
 * LE GLYPHE N'EST PAS DÉCORATIF : il est le canal REDONDANT de la couleur.
 * Un tableau imprimé en noir et blanc, ou lu par quelqu'un qui ne distingue
 * pas le rouge du vert, doit rester interprétable — d'où `▲ Manque` plutôt
 * qu'un simple mot rouge. Jamais de fond de rangée coloré : la couleur porte
 * l'état de la VALEUR, pas de la ligne.
 *
 * `aria-hidden` sur le glyphe : il double la couleur pour l'œil, il n'ajoute
 * rien à l'oreille — le libellé suffit et se lit seul.
 */
export function PastilleStatut({ statut, libelle }: { statut: Statut; libelle: string }) {
  return (
    <span
      className={`inline-flex items-center gap-groupe font-medium ${CLASSE_TEXTE_STATUT[statut]}`}
    >
      <span aria-hidden="true">{GLYPHE_STATUT[statut]}</span>
      {libelle}
    </span>
  );
}

/**
 * Une ligne d'une fiche de détail : intitulé à gauche, valeur à droite.
 *
 * `<dt>`/`<dd>` et non deux `<span>` : c'est une liste de DÉFINITIONS, et le
 * balisage le dit — un lecteur d'écran annonce alors la paire, pas deux textes
 * sans lien. L'appelant doit donc l'envelopper dans un `<dl>`.
 *
 * `num` sur la valeur : chiffres tabulaires, pour que les montants d'une même
 * fiche s'alignent verticalement sur la virgule.
 */
export function LigneFiche({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-ink-3">{libelle}</dt>
      <dd className="num text-ink">{valeur}</dd>
    </div>
  );
}
