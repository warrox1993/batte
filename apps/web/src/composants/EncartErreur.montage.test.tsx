/**
 * `EncartErreur` — la frontière entre une PANNE et une ALERTE MÉTIER.
 *
 * ═══ Ce que ce fichier ajoute à `EncartErreur.test.tsx` ═══
 *
 * `EncartErreur.test.tsx`, à côté, reste valable et n'est pas touché : il
 * couvre `messageErreurAffichable` (quelle phrase s'affiche) et le balisage
 * produit. Il ne touche jamais `natureDuRefus`.
 *
 * Or `natureDuRefus` est la fonction qui décide du REGISTRE — la seule
 * question à laquelle les 78 corrections du 01/08/2026 répondaient. Elle était
 * exécutée par les tests (la couverture de ce fichier affichait 100 %) sans
 * qu'aucune assertion ne porte sur son verdict : trois cas la traversaient
 * depuis `BoutonDocument.montage.test.tsx` (422, 500, `TypeError`), et
 * **aucune de ses frontières n'était interrogée**. C'est le « vert par
 * absence » exact que ce dépôt traque : 100 % de lignes couvertes ne dit rien
 * des décisions prises sur ces lignes.
 *
 * Ce fichier interroge donc les BORNES (399 / 400 / 499 / 500), les valeurs
 * lancées qui ne sont pas des `Error`, et surtout la COMPOSITION réelle qui a
 * produit le défaut : un `ErreurParametreManquant` arrive en 500 — donc
 * registre technique — mais son message reste une clé de catalogue, qu'il faut
 * remplacer par une phrase actionnable. Les deux fonctions doivent jouer
 * ensemble, et rien ne les avait jamais vues jouer ensemble.
 *
 * ═══ Ce que ce fichier ne prouve pas ═══
 *
 * Que la couleur du registre soit LISIBLE ni conforme au jeton Tailwind :
 * jsdom n'applique aucune feuille de style. Il prouve quelle décision est
 * prise et quel texte est exposé à l'arbre d'accessibilité.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErreurApi } from '../lib/api';
import {
  EncartErreur,
  MessageErreur,
  messageErreurAffichable,
  natureDuRefus,
} from './EncartErreur';

const MESSAGE_PARAMETRE_MANQUANT_BRUT =
  "Le paramètre « echeance_e604b_tolerance_cents » n'est pas défini. Renseignez-le dans Paramètres avant de continuer.";

function erreurAvecStatut(statut: number): ErreurApi {
  return new ErreurApi('Peu importe le texte ici.', { code: 'quelconque', statut });
}

describe('natureDuRefus — les BORNES de la distinction (jamais interrogées jusqu’ici)', () => {
  /**
   * 400 et 499 sont les deux bornes du registre MÉTIER, 399 et 500 les deux
   * premiers pas en dehors. Tester 422 seul — le seul cas que le dépôt
   * connaissait — laisserait passer un `>= 400 && <= 500`, un `> 400`, ou un
   * `< 600` : trois erreurs d'un caractère qui recolleraient les deux
   * registres que les 78 corrections viennent de séparer.
   */
  const cas: ReadonlyArray<readonly [number, 'metier' | 'technique']> = [
    [399, 'technique'],
    [400, 'metier'],
    [404, 'metier'],
    [409, 'metier'],
    [422, 'metier'],
    [499, 'metier'],
    [500, 'technique'],
    [502, 'technique'],
    [503, 'technique'],
  ];

  it.each(cas)('un statut %i relève du registre « %s »', (statut, attendu) => {
    expect(natureDuRefus(erreurAvecStatut(statut))).toBe(attendu);
  });

  it('une panne réseau (statut 0) est TECHNIQUE : le porteur n’y peut rien', () => {
    // C'est exactement ce que fabrique `erreurReseau()` dans `lib/api.ts`.
    const coupure = new ErreurApi('Impossible de contacter le serveur.', {
      code: 'reseau_indisponible',
      statut: 0,
    });
    expect(natureDuRefus(coupure)).toBe('technique');
  });

  /**
   * Le `instanceof ErreurApi` est le pivot de la fonction. Une valeur lancée
   * qui n'est pas une `ErreurApi` — y compris une `Error` ordinaire, y compris
   * quelque chose qui n'est même pas une `Error` — ne peut pas être un refus
   * raisonné du serveur, donc jamais du registre métier.
   */
  const valeursQuiNeSontPasDesErreursApi: ReadonlyArray<readonly [string, unknown]> = [
    ['une coupure `fetch`', new TypeError('Failed to fetch')],
    ['une `Error` ordinaire', new Error('boom')],
    ['une chaîne lancée telle quelle', 'boom'],
    ['`null`', null],
    ['`undefined`', undefined],
    ['un objet qui RESSEMBLE à une ErreurApi sans en être une', { statut: 422, code: 'x' }],
  ];

  it.each(valeursQuiNeSontPasDesErreursApi)('%s reste TECHNIQUE', (_, valeur) => {
    expect(natureDuRefus(valeur)).toBe('technique');
  });

  it('l’imitateur ci-dessus le prouve : c’est bien la CLASSE qui décide, pas la forme', () => {
    // Un test qui n'aurait que des `TypeError` laisserait passer un
    // `typeof erreur === 'object' && 'statut' in erreur`. L'imitateur porte un
    // 422 parfaitement formé et doit malgré tout rester technique.
    const imitateur = { statut: 422, code: 'aucun_produit_actif', message: 'Aucun produit actif.' };
    expect(natureDuRefus(imitateur)).toBe('technique');
    // Et la vraie classe, avec le même statut, bascule bien de l'autre côté.
    expect(natureDuRefus(erreurAvecStatut(422))).toBe('metier');
  });
});

describe('natureDuRefus + messageErreurAffichable — la COMPOSITION qui a produit le défaut', () => {
  it('un paramètre absent arrive en 500 : registre TECHNIQUE, message REMPLACÉ', () => {
    // Le cas réel du 31/07/2026 : deux routes du tableau de bord répondaient
    // 500 parce qu'une clé manquait au catalogue. Les deux décisions sont
    // indépendantes et doivent toutes deux tomber juste :
    //  - la NATURE vient du statut (500 → technique, aucune décision à prendre) ;
    //  - le TEXTE vient du message (clé technique → phrase actionnable).
    const erreur = new ErreurApi(MESSAGE_PARAMETRE_MANQUANT_BRUT, {
      code: 'parametre_manquant',
      statut: 500,
    });

    expect(natureDuRefus(erreur)).toBe('technique');

    const affichable = messageErreurAffichable(erreur.message);
    expect(affichable.principal).toContain('npm run db:seed');
    expect(affichable.principal).not.toContain('echeance_e604b_tolerance_cents');
    expect(affichable.detailTechnique).toBe(MESSAGE_PARAMETRE_MANQUANT_BRUT);
  });

  it('un refus métier garde SON message : on ne remplace jamais une phrase déjà actionnable', () => {
    const erreur = new ErreurApi(
      "Cette session est en statut « Planifiée » : le rapport n'est éditable qu'après clôture.",
      { code: 'session_non_cloturee', statut: 409 },
    );
    expect(natureDuRefus(erreur)).toBe('metier');
    expect(messageErreurAffichable(erreur.message).principal).toBe(erreur.message);
  });
});

describe('MessageErreur monté — ce que l’arbre d’accessibilité expose réellement', () => {
  it('annonce le message par `role="alert"`, avec le texte DEDANS', () => {
    // Une assertion par RÔLE et non par sous-chaîne de balisage : elle prouve
    // que le texte est bien porté par l'élément annoncé, et pas posé à côté
    // d'un `role="alert"` vide — ce qu'un lecteur d'écran ne lirait jamais.
    render(<MessageErreur message="Le serveur n’a pas répondu." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Le serveur n’a pas répondu.');
  });

  it('la clé technique n’est JAMAIS la première phrase lue', () => {
    render(<MessageErreur message={MESSAGE_PARAMETRE_MANQUANT_BRUT} />);
    const alerte = screen.getByRole('alert');

    const texte = alerte.textContent ?? '';
    const positionPhrase = texte.indexOf('npm run db:seed');
    const positionCle = texte.indexOf('echeance_e604b_tolerance_cents');
    expect(positionPhrase).toBeGreaterThanOrEqual(0);
    expect(positionCle).toBeGreaterThan(positionPhrase);
  });

  it('n’ajoute aucun second paragraphe quand il n’y a pas de détail technique', () => {
    render(<MessageErreur message="Erreur quelconque." />);
    expect(screen.getByRole('alert').querySelectorAll('p')).toHaveLength(1);
  });
});

describe('EncartErreur monté — l’encart ne disparaît pas avec son titre', () => {
  it('garde un titre de niveau 2 ET l’alerte, dans le même encart', () => {
    // Le défaut corrigé : l'encart entier disparaissait, remplacé par un
    // bandeau rouge nu — le porteur ne pouvait pas dire QUEL encart était mort.
    render(<EncartErreur titre="Seuils légaux" message="Le serveur n’a pas répondu." />);

    const titre = screen.getByRole('heading', { level: 2, name: 'Seuils légaux' });
    const alerte = screen.getByRole('alert');

    expect(titre).toBeInTheDocument();
    expect(alerte).toHaveTextContent('Le serveur n’a pas répondu.');
    // Les deux appartiennent au MÊME encart : c'est ce qui empêche le bandeau
    // d'aller se coller sous l'encart voisin, comme s'il lui appartenait.
    expect(titre.closest('section')).toBe(alerte.closest('section'));
  });

  it('deux encarts en erreur restent distinguables l’un de l’autre', () => {
    render(
      <>
        <EncartErreur titre="Seuils légaux" message="Le serveur n’a pas répondu." />
        <EncartErreur titre="À traiter" message="Le serveur n’a pas répondu." />
      </>,
    );

    // Le point du correctif : DEUX titres, donc deux encarts identifiables,
    // là où l'ancien code produisait deux bandeaux rouges anonymes.
    expect(screen.getByRole('heading', { level: 2, name: 'Seuils légaux' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'À traiter' })).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });
});
