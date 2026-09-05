import type { ReactNode } from 'react';

type PanneauProps = {
  titre: string;
  children: ReactNode;
  /**
   * Corps sans rembourrage quand il contient un tableau : un `Tableau` gère
   * déjà ses propres marges de cellule (docs/07-DOCTRINE-ERP-ET-DESIGN.md
   * §4.5). Sans cette prop, le tableau recevrait un double rembourrage
   * horizontal (celui du panneau, puis celui de la première/dernière colonne).
   */
  sansRembourrage?: boolean;
};

/**
 * Panneau reutilisable pour les blocs denses (tableau de bord, listes
 * courtes, tableaux). Reprend la logique des encadres ASCII de
 * docs/06-UI-ET-PARCOURS.md (« ┌─ TITRE ─┐ »), sans ombre ni degrade —
 * la profondeur vient uniquement de l'ecart de luminance canvas/surface.
 *
 * Regle absolue : JAMAIS de panneau dans un panneau. A l'interieur, on
 * separe par un filet pleine largeur (`border-t border-line`), pas par un
 * second `<Panneau>` (docs/07 §4.8 : « cartes imbriquees : profondeur
 * maximale 1 »).
 */
export function Panneau({ titre, children, sansRembourrage = false }: PanneauProps) {
  return (
    <section className="rounded-md border border-line-strong bg-surface">
      {/* `text-ink-2` et non `text-ink-3` : les 4,88:1 annonces par `index.css`
          valent sur `--surface` (blanc). Sur `--surface-sunken` (#ebebed), le
          fond REEL de cet en-tete, `--ink-3` retombe a 4,06:1 — sous le
          minimum AA de 4,5:1 pour un texte de 11 px. Mesure au navigateur.
          `--ink-2` y donne 8,77:1. */}
      <h2 className="flex h-rangee items-center border-b border-line-strong bg-surface-sunken px-4 text-2xs uppercase text-ink-2">
        {titre}
      </h2>
      <div className={sansRembourrage ? undefined : 'p-4'}>{children}</div>
    </section>
  );
}
