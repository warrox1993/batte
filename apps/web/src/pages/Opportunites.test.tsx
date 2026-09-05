import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { formaterMontant, type LigneOpportunite } from '@batte/core';
import {
  celluleMontantOuTiret,
  estPremierPassageLigne,
  phraseCoutKilometrique,
} from './Opportunites';

/**
 * `phraseCoutKilometrique` (audit du 31/07/2026) : `meta.coutKilometriqueCentsParKm`
 * et `meta.coutKilometriqueSource` (`schemaListeOpportunites`,
 * `packages/core/src/contrats/opportunites.ts:79-80`) étaient calculés,
 * testés, servis par `GET /opportunites`, et jamais lus par cet écran — un
 * champ HOMONYME (même nom, schéma différent) est bien affiché sur
 * `ComparaisonLieux.tsx` via `/lieux-rentabilite`, ce qui a fait échapper
 * CELUI-CI à une première recherche textuelle sur le seul nom du champ.
 *
 * Ce fichier ne monte pas l'écran (voir `Opportunites.montage.test.tsx`) :
 * ces tests prouvent la composition de la PHRASE, pas son rendu réel dans le
 * DOM.
 */
describe('phraseCoutKilometrique — le taux qui produit CHAQUE coût de déplacement (colonne « Frais (€) », fusionnée avec « Emplacement (€) » le 31/07/2026) de la liste', () => {
  it('affiche le taux avec QUATRE décimales, jamais deux (barème officiel fractionnaire)', () => {
    const phrase = phraseCoutKilometrique({
      coutKilometriqueCentsParKm: 47.61,
      coutKilometriqueSource: 'Barème kilométrique SPF Mobilité 2026',
    });

    expect(phrase).toBe(
      'Coût de déplacement calculé à 0,4761 €/km (Barème kilométrique SPF Mobilité 2026).',
    );
  });

  it('n’arrondit jamais à deux décimales — un `0,48 €/km` ferait disparaître le dernier chiffre du barème', () => {
    const phrase = phraseCoutKilometrique({
      coutKilometriqueCentsParKm: 47.61,
      coutKilometriqueSource: 'Source',
    });

    expect(phrase).not.toContain('0,48 €/km');
    expect(phrase).toContain('0,4761 €/km');
  });

  it('omet la parenthèse quand la source est vide, plutôt que d’afficher des parenthèses vides', () => {
    const phrase = phraseCoutKilometrique({
      coutKilometriqueCentsParKm: 200,
      coutKilometriqueSource: '',
    });

    expect(phrase).toBe('Coût de déplacement calculé à 2,0000 €/km.');
    expect(phrase).not.toContain('(');
  });
});

/** Ligne minimale valide (`schemaLigneOpportunite`), à surcharger par test. */
function ligne(surcharges: Partial<LigneOpportunite> = {}): LigneOpportunite {
  return {
    id: 'opp-1',
    nom: 'Test',
    type: 'festival',
    famille: 'grand_public',
    dateDebut: '2099-12-01',
    dateFin: '2099-12-01',
    nbSessions: 1,
    communeTexte: null,
    lieuId: null,
    lieuNom: null,
    distanceKm: null,
    distanceEstimeeVolDoiseau: false,
    effectifEstime: null,
    fiabilite: 'aucune_donnee',
    nbSessionsRetenues: 0,
    explicationPrevision: 'Premier passage : aucune session n’a encore été close à cet endroit.',
    crepesPrevuesParSession: null,
    crepesPrevuesTotal: null,
    caAttenduCents: null,
    coutMatiereAttenduCents: null,
    coutGazAttenduCents: null,
    coutEmplacementCents: null,
    coutEmplacementIndisponibleRaison: null,
    coutDeplacementCents: null,
    margeNetteAttendueCents: null,
    source: null,
    notes: null,
    ...surcharges,
  };
}

/**
 * D-082 (`docs/05-DECISIONS.md`) : la mention « premier passage » ne
 * s'affiche QUE pour un grand public/marché de Noël dont le lieu n'a encore
 * reçu aucune session close — jamais pour un stand entreprise, dont
 * `nbSessionsRetenues` compte une toute autre chose (sessions déjà tenues
 * chez CETTE entreprise, D-059), et jamais dès qu'UNE session existe.
 */
describe('estPremierPassageLigne — la mention ne s’affiche que pour le bon cas', () => {
  it('vaut vrai pour un grand public/marché de Noël à zéro session close', () => {
    expect(estPremierPassageLigne(ligne({ famille: 'grand_public', nbSessionsRetenues: 0 }))).toBe(
      true,
    );
    expect(estPremierPassageLigne(ligne({ famille: 'marche_noel', nbSessionsRetenues: 0 }))).toBe(
      true,
    );
  });

  it('vaut faux dès qu’une session est close, même une seule', () => {
    expect(estPremierPassageLigne(ligne({ famille: 'grand_public', nbSessionsRetenues: 1 }))).toBe(
      false,
    );
  });

  it('vaut TOUJOURS faux pour une entreprise, même à zéro session — autre cause, autre message', () => {
    expect(estPremierPassageLigne(ligne({ famille: 'entreprise', nbSessionsRetenues: 0 }))).toBe(
      false,
    );
  });
});

/**
 * `celluleMontantOuTiret` — rend la valeur formatée quand elle est connue,
 * sinon un tiret NU (jamais une prévision de zéro) accompagné de la mention
 * « premier passage » seulement quand `estPremierPassageLigne` le justifie.
 *
 * `renderToStaticMarkup` (pas de montage complet dans ce fichier — voir
 * `Opportunites.montage.test.tsx`) : ces tests prouvent le balisage produit,
 * pas un clic ou un survol réel.
 */
describe('celluleMontantOuTiret — jamais un tiret nu pour un premier passage', () => {
  it('affiche le montant formaté quand la valeur est connue', () => {
    const balisage = renderToStaticMarkup(
      <>{celluleMontantOuTiret(384_950, ligne({ caAttenduCents: 384_950 }))}</>,
    );
    expect(balisage).toContain(formaterMontant(384_950));
  });

  it('affiche un tiret SEUL, sans mention, pour une entreprise sans taux de prise mesuré', () => {
    const balisage = renderToStaticMarkup(
      <>
        {celluleMontantOuTiret(
          null,
          ligne({ famille: 'entreprise', nbSessionsRetenues: 2, caAttenduCents: null }),
        )}
      </>,
    );
    expect(balisage).toContain('—');
    expect(balisage).not.toContain('premier passage');
  });

  it('ajoute la mention « premier passage » pour un grand public jamais visité', () => {
    const balisage = renderToStaticMarkup(
      <>
        {celluleMontantOuTiret(
          null,
          ligne({ famille: 'grand_public', nbSessionsRetenues: 0, caAttenduCents: null }),
        )}
      </>,
    );
    expect(balisage).toContain('—');
    expect(balisage).toContain('premier passage');
  });
});
