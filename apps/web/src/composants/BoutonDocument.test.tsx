import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BoutonDocument, messageActionnable } from './BoutonDocument';
import { natureDuRefus } from './EncartErreur';
import { ErreurApi, nomFichierDepuisEnTete } from '../lib/api';
import { moisEcoule } from '../pages/RegistreAfsca';

/**
 * Même dispositif que `Tableau.test.tsx` : ce fichier ne monte pas le
 * composant. On vérifie donc :
 *
 *  - le BALISAGE rendu, via `renderToStaticMarkup` — c'est ce qui porte les
 *    garanties de clavier et d'accessibilité ;
 *  - les fonctions PURES de la chaîne (`nomFichierDepuisEnTete`, `moisEcoule`).
 *
 * Ce que ce dispositif ne peut PAS prouver : qu'un clic déclenche réellement le
 * téléchargement, ni que le bouton reste inerte pendant la génération —
 * `useState` ne s'exécute pas dans un rendu statique. Ces deux moitiés-là sont
 * couvertes par `BoutonDocument.montage.test.tsx` et
 * `BoutonDocument.telechargement.test.tsx`, à côté de ce fichier.
 */

describe('BoutonDocument — balisage', () => {
  it('est un bouton, donc atteignable par tabulation et déclenchable par Entrée', () => {
    const balisage = renderToStaticMarkup(
      <BoutonDocument chemin="/exports/stock" libelle="État du stock (Excel)" />,
    );
    // `type="button"` : sans lui, le bouton soumettrait le formulaire qui
    // l'entoure (celui d'envoi de commande, dans `Achats.tsx`).
    expect(balisage).toContain('type="button"');
    expect(balisage).toContain('État du stock (Excel)');
    // Aucun `disabled` natif : le focus doit survivre à la génération.
    expect(balisage).not.toContain('disabled=""');
  });

  it('annonce son indisponibilité sans perdre le focus (aria-disabled, pas disabled)', () => {
    const balisage = renderToStaticMarkup(
      <BoutonDocument
        chemin="/documents/rapport-session/abc"
        libelle="Éditer le rapport de session (PDF)"
        raisonIndisponible="Cette session est en statut « En cours » : le rapport n’est éditable qu’après clôture."
      />,
    );
    expect(balisage).toContain('aria-disabled="true"');
    expect(balisage).not.toContain('disabled=""');
    // La raison est lisible à la souris avant même de cliquer.
    expect(balisage).toContain('title="Cette session est en statut');
  });

  it('n’utilise que des jetons sémantiques, jamais une couleur Tailwind brute', () => {
    const balisage = renderToStaticMarkup(
      <BoutonDocument chemin="/exports/stock" libelle="Export" variante="primaire" />,
    );
    // docs/07 §4.9 : `bg-blue-600`, `text-red-500`… n'existent pas dans ce produit.
    expect(balisage).not.toMatch(/(bg|text|border)-(blue|red|green|amber|gray|zinc|slate)-\d/);
    expect(balisage).toContain('bg-accent');
  });

  it('porte l’anneau de focus visible exigé par la règle n°10', () => {
    const balisage = renderToStaticMarkup(<BoutonDocument chemin="/exports/stock" libelle="X" />);
    expect(balisage).toContain('focus-visible:outline-accent');
  });
});

describe('nomFichierDepuisEnTete', () => {
  it('lit le nom versionné produit par l’archivage D-026', () => {
    expect(
      nomFichierDepuisEnTete('inline; filename="registre_afsca_2026-06_v1_20260728-2033.pdf"'),
    ).toBe('registre_afsca_2026-06_v1_20260728-2033.pdf');
  });

  it('accepte la forme sans guillemets', () => {
    expect(nomFichierDepuisEnTete('attachment; filename=export.xlsx')).toBe('export.xlsx');
  });

  it('préfère la forme étendue RFC 6266 et la décode', () => {
    expect(
      nomFichierDepuisEnTete(
        "attachment; filename=repli.pdf; filename*=UTF-8''fiche%20cr%C3%AApe.pdf",
      ),
    ).toBe('fiche crêpe.pdf');
  });

  it('retombe sur `filename` si la séquence de pourcentage est invalide', () => {
    expect(
      nomFichierDepuisEnTete('attachment; filename="repli.pdf"; filename*=UTF-8\'\'%E0%A4%A'),
    ).toBe('repli.pdf');
  });

  it('ne garde jamais de chemin : un nom de téléchargement n’en porte pas', () => {
    expect(nomFichierDepuisEnTete('inline; filename="../../evasion.pdf"')).toBe('evasion.pdf');
    expect(nomFichierDepuisEnTete('inline; filename="C:\\Windows\\hosts"')).toBe('hosts');
  });

  it('rend null quand l’en-tête est absent ou muet', () => {
    expect(nomFichierDepuisEnTete(null)).toBeNull();
    expect(nomFichierDepuisEnTete('inline')).toBeNull();
    expect(nomFichierDepuisEnTete('inline; filename=""')).toBeNull();
  });
});

describe('messageActionnable — ce que l’utilisateur lit sur un 422', () => {
  it('reprend tel quel le message d’une erreur MÉTIER, qui dit déjà quoi faire', () => {
    const erreur = new ErreurApi(
      "Aucun produit actif : l'affichette serait vide. Activez au moins un produit de la carte avant de l'éditer.",
      { code: 'aucun_produit_actif', statut: 422 },
    );
    expect(messageActionnable(erreur)).toContain('Activez au moins un produit');
  });

  it('préfère le détail de `champs` au message générique d’une erreur de VALIDATION', () => {
    // Mesuré à l'écran : afficher `message` ici ne donnait que « La saisie
    // contient des champs invalides. », soit un échec sans remède.
    const erreur = new ErreurApi('La saisie contient des champs invalides.', {
      code: 'validation',
      statut: 422,
      champs: { annee: 'Exercice trop ancien : indiquez une année à partir de 2000.' },
    });
    expect(messageActionnable(erreur)).toBe(
      'Exercice trop ancien : indiquez une année à partir de 2000.',
    );
  });

  it('joint plusieurs champs fautifs plutôt que d’en taire un', () => {
    const erreur = new ErreurApi('La saisie contient des champs invalides.', {
      code: 'validation',
      statut: 422,
      champs: { periode: 'Indiquez un mois au format AAAA-MM.', annee: 'Exercice trop lointain.' },
    });
    expect(messageActionnable(erreur)).toBe(
      'Indiquez un mois au format AAAA-MM. Exercice trop lointain.',
    );
  });
});

/**
 * Le même bouton refuse pour deux raisons de nature opposée, et l'écran ne
 * doit pas les afficher pareil : « cette session n'est pas encore clôturée »
 * demande une action du porteur, « le serveur n'a pas répondu » n'en demande
 * aucune. C'est le tri appliqué à 78 emplacements de l'application le
 * 01/08/2026 ; ce composant en portait un que le balayage n'a pas couvert.
 */
describe('natureDuRefus — une panne n’est pas une condition métier non remplie', () => {
  it('classe un 422 en MÉTIER : le serveur a refusé pour une raison qui dit quoi faire', () => {
    const refus = new ErreurApi(
      "Aucun produit actif : l'affichette serait vide. Activez au moins un produit de la carte avant de l'éditer.",
      { code: 'aucun_produit_actif', statut: 422 },
    );
    expect(natureDuRefus(refus)).toBe('metier');
  });

  it('classe un 404 en MÉTIER : la pièce demandée n’existe pas, ce n’est pas une panne', () => {
    expect(
      natureDuRefus(new ErreurApi('Session introuvable.', { code: 'introuvable', statut: 404 })),
    ).toBe('metier');
  });

  it('classe un 500 en TECHNIQUE : le porteur n’y peut rien', () => {
    expect(
      natureDuRefus(
        new ErreurApi('Erreur inattendue du serveur.', { code: 'interne', statut: 500 }),
      ),
    ).toBe('technique');
  });

  it('classe une coupure réseau en TECHNIQUE — c’est le cas qui n’est même pas une ErreurApi', () => {
    expect(natureDuRefus(new TypeError('Failed to fetch'))).toBe('technique');
    // Une valeur lancée qui n'est pas une `Error` du tout : un `catch` en voit,
    // et la classer en métier ferait crier l'écran pour rien.
    expect(natureDuRefus('quelque chose est tombé')).toBe('technique');
  });
});

describe('moisEcoule — période par défaut du registre AFSCA', () => {
  it('rend le mois précédent, jamais le mois en cours', () => {
    expect(moisEcoule('2026-07-28')).toBe('2026-06');
    expect(moisEcoule('2026-12-31')).toBe('2026-11');
  });

  it('bascule sur décembre de l’année précédente en janvier', () => {
    expect(moisEcoule('2026-01-05')).toBe('2025-12');
  });

  it('rend une valeur directement acceptée par la route (AAAA-MM, mois sur deux chiffres)', () => {
    expect(moisEcoule('2026-10-01')).toBe('2026-09');
    expect(moisEcoule('2026-02-15')).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });
});
