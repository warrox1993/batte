import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BadgeReceptionAnnulee, BadgeReleveAnnule } from './RegistreAfsca';

/**
 * Câblage du badge « Réception annulée » (mission du 30/07/2026) :
 * `receptionStatut` (`'active' | 'annulee'`) est désormais servi par les
 * routes de traçabilité amont et aval, mais rien à l'écran ne le disait.
 *
 * Ce fichier ne monte pas l'écran : comme les autres tests de cet écran ici,
 * on rend le composant PUR via `renderToStaticMarkup`. Le montage vit dans
 * `RegistreAfsca.montage.test.tsx`, à côté.
 *
 * Le badge DÉCORE, il ne filtre rien (CLAUDE.md §7 : rien ne se réécrit) :
 * ce test ne porte donc que sur SA présence, jamais sur la disparition d'une
 * ligne ou d'un lot.
 */

describe('BadgeReceptionAnnulee — le fil vers le rendu', () => {
  it('affiche un badge quand la réception a été annulée', () => {
    const balisage = renderToStaticMarkup(<BadgeReceptionAnnulee statut="annulee" />);
    expect(balisage).toContain('réception annulée');
  });

  it('ne rend rien pour une réception active — jamais un badge qui laisserait croire à une annulation qui n’a pas eu lieu', () => {
    expect(renderToStaticMarkup(<BadgeReceptionAnnulee statut="active" />)).toBe('');
  });
});

/**
 * D-083 (31/07/2026) : même badge, même raisonnement, pour un relevé de
 * température annulé PAR ÉCRITURE NOUVELLE — voir `BadgeReleveAnnule`
 * (`RegistreAfsca.tsx`).
 */
describe('BadgeReleveAnnule — le fil vers le rendu', () => {
  it('affiche un badge quand le relevé a été annulé', () => {
    const balisage = renderToStaticMarkup(
      <BadgeReleveAnnule statut="annulee" motif="Thermomètre mal calibré." />,
    );
    expect(balisage).toContain('relevé annulé');
  });

  it('ne rend rien pour un relevé actif — jamais un badge qui laisserait croire à une annulation qui n’a pas eu lieu', () => {
    expect(renderToStaticMarkup(<BadgeReleveAnnule statut="active" motif={null} />)).toBe('');
  });

  it('porte le motif en infobulle quand il est connu, un texte générique sinon — jamais un motif fabriqué', () => {
    const avecMotif = renderToStaticMarkup(
      <BadgeReleveAnnule statut="annulee" motif="Erreur de saisie." />,
    );
    expect(avecMotif).toContain('Erreur de saisie.');

    const sansMotif = renderToStaticMarkup(<BadgeReleveAnnule statut="annulee" motif={null} />);
    expect(sansMotif).not.toContain('Erreur de saisie.');
    expect(sansMotif).toContain('tracé pour mémoire');
  });
});
