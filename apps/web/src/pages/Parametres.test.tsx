import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { decouperCleAvecPointsDeRupture, valeurTropLonguePourListe } from './Parametres';

/**
 * Mission « tableaux lisibles » (31/07/2026), `docs/23-AUDIT-VISUEL.md` §2.2.
 *
 * `overflow-wrap: anywhere` (index.css, hors zone d'écriture) coupe une clé de
 * paramètre au milieu d'un mot dès qu'aucun point de rupture « naturel »
 * n'existe avant la limite de largeur — mesuré : `cout_kilometrique_mesure_
 * pleins_minimum` se coupait en `cout_kilometrique_mesure_pleins_mini` /
 * `mum`. `decouperCleAvecPointsDeRupture` insère un `<wbr>` après chaque
 * « _ » pour que la coupure, quand elle a lieu, tombe TOUJOURS entre deux
 * segments plutôt qu'au milieu d'un mot.
 *
 * Testée par `renderToStaticMarkup` (pas de montage complet dans ce
 * fichier : UN rendu, dans l'état initial), même convention
 * que `composants/Tableau.test.tsx`.
 */

function rendre(cle: string): string {
  return renderToStaticMarkup(<span>{decouperCleAvecPointsDeRupture(cle)}</span>);
}

/** Le texte réellement affiché, `<wbr>` ôté : ce qu'un lecteur ou un copier-coller voit. */
function texteSansBalises(balisage: string): string {
  return balisage.replace(/<[^>]*>/g, '');
}

describe('decouperCleAvecPointsDeRupture', () => {
  it('ne modifie ni n’ajoute aucun caractère visible : la clé recopiée reste identique', () => {
    const cle = 'cout_kilometrique_mesure_pleins_minimum';
    expect(texteSansBalises(rendre(cle))).toBe(cle);
  });

  it('insère un point de rupture après chaque « _ », jamais avant le premier segment', () => {
    const balisage = rendre('evenement_coefficient_portee_bp');
    // Trois « _ » dans cette clé → trois <wbr>.
    expect((balisage.match(/<wbr\/?>/g) ?? []).length).toBe(3);
    expect(balisage.startsWith('<wbr')).toBe(false);
  });

  it('ne pose aucun <wbr> sur une clé sans « _ »', () => {
    const balisage = rendre('adresse');
    expect(balisage).not.toContain('<wbr');
    expect(texteSansBalises(balisage)).toBe('adresse');
  });

  it('place chaque <wbr> immédiatement après le « _ » qui le précède', () => {
    // `<wbr>` doit suivre le « _ », pas le remplacer ni le précéder : sans
    // quoi la rupture tomberait avant le séparateur plutôt qu'après.
    const balisage = rendre('afsca_motifs_incident_sanitaire_json');
    expect(balisage).toMatch(
      /afsca_<wbr\/?>motifs_<wbr\/?>incident_<wbr\/?>sanitaire_<wbr\/?>json/,
    );
  });
});

/**
 * Mission « les deux écrans qui perdent du texte » (01/08/2026),
 * `docs/36-AUDIT-TROIS-RESOLUTIONS.md` §2 rang 3 : la colonne « En vigueur »
 * tronque SIX valeurs de `packages/core/src/parametres.ts` à TOUTES les
 * largeurs testées (1280, 1920, 2560) — cinq citations légales
 * (`echeance_*_source_legale`, 117 à 310 caractères) et un tableau JSON de
 * codes motif AFSCA (`afsca_motifs_incident_sanitaire_json`, 72 caractères).
 * Ce n'est pas un manque de place : même à 2560 px (383 px de colonne), rien
 * de cette taille ne rentre. `valeurTropLonguePourListe` décide donc, à la
 * longueur, quand une cellule doit renvoyer vers la fiche plutôt que
 * d'afficher un fragment tronqué qui perdrait silencieusement la partie la
 * plus importante d'une règle légale.
 *
 * Les trois longueurs ci-dessous sont les vraies longueurs mesurées des
 * valeurs par défaut du dépôt (script Node ad hoc sur
 * `packages/core/src/parametres.ts`, 01/08/2026), pas des exemples inventés :
 * 25 pour `ia_modele_extraction` (« claude-haiku-4-5-20251001 », qui se
 * résout tout seul à 1920/2560 et garde donc l'ellipse + infobulle
 * habituelle), 72 pour `afsca_motifs_incident_sanitaire_json`, et 117 à 310
 * pour les cinq `echeance_*_source_legale`. Le seuil (40) est choisi loin des
 * deux bords de cet écart réel, pas au plus juste.
 */
describe('valeurTropLonguePourListe — une citation légale n’est pas une donnée tabulaire', () => {
  it('laisse passer un identifiant fonctionnel réel (« claude-haiku-4-5-20251001 », 25 caractères)', () => {
    expect(valeurTropLonguePourListe('claude-haiku-4-5-20251001')).toBe(false);
  });

  it('laisse passer les valeurs courtes usuelles (montants, dates MM-JJ, booléens)', () => {
    expect(valeurTropLonguePourListe('17 374,08 €')).toBe(false);
    expect(valeurTropLonguePourListe('12-15')).toBe(false);
    expect(valeurTropLonguePourListe('true')).toBe(false);
  });

  it('signale un tableau JSON réel du dépôt (72 caractères) comme trop long pour la liste', () => {
    const motifsJson = '["RAPPEL_FOURNISSEUR","QUARANTAINE_DOUTE","DLC_DEPASSEE","NON_CONFORME"]';
    expect(motifsJson.length).toBe(72);
    expect(valeurTropLonguePourListe(motifsJson)).toBe(true);
  });

  it('signale les cinq citations légales réelles du dépôt comme trop longues pour la liste', () => {
    const longueurs = [117, 160, 193, 212, 310]; // echeance_*_source_legale, mesurées le 01/08/2026
    for (const longueur of longueurs) {
      expect(valeurTropLonguePourListe('a'.repeat(longueur))).toBe(true);
    }
  });

  it('trace nettement la frontière au seuil déclaré', () => {
    expect(valeurTropLonguePourListe('a'.repeat(40))).toBe(false);
    expect(valeurTropLonguePourListe('a'.repeat(41))).toBe(true);
  });
});
