import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EncartErreur, MessageErreur, messageErreurAffichable } from './EncartErreur';

/**
 * Ce fichier ne monte pas le composant : on vérifie la DÉCISION via la
 * fonction pure `messageErreurAffichable`, et le balisage réellement produit
 * via `renderToStaticMarkup` — même dispositif que `Tableau.test.tsx` /
 * `BoutonDocument.test.tsx`. Le montage vit dans
 * `EncartErreur.montage.test.tsx`.
 *
 * CE QUE CES TESTS NE PROUVENT PAS : qu'un vrai 500 de l'API atteint bien ce
 * composant en conditions réelles (aucun appel réseau ici), ni que
 * `renderToStaticMarkup` reflète le layout au pixel près une fois monté dans
 * un navigateur — seulement que le balisage contient (ou ne contient pas) ce
 * qu'il doit contenir. La preuve « conditions réelles » est la capture
 * d'écran prise séparément sur l'instance isolée (5041/5042).
 */

const MESSAGE_PARAMETRE_MANQUANT_BRUT =
  "Le paramètre « echeance_e604b_tolerance_cents » n'est pas défini. Renseignez-le dans Paramètres avant de continuer.";

describe('messageErreurAffichable — classe d’erreur, jamais un dictionnaire clé par clé', () => {
  it('reconnaît le message FIXE de `ErreurParametreManquant`, quelle que soit la clé', () => {
    const resultat = messageErreurAffichable(MESSAGE_PARAMETRE_MANQUANT_BRUT);
    expect(resultat.principal).not.toContain('echeance_e604b_tolerance_cents');
    expect(resultat.principal).not.toContain('_');
    expect(resultat.detailTechnique).toBe(MESSAGE_PARAMETRE_MANQUANT_BRUT);
  });

  it('dit QUOI FAIRE (une commande concrète), pas seulement qu’un réglage manque', () => {
    const resultat = messageErreurAffichable(MESSAGE_PARAMETRE_MANQUANT_BRUT);
    expect(resultat.principal).toContain('npm run db:seed');
  });

  it('reconnaît la même classe pour une AUTRE clé, sans dictionnaire clé par clé', () => {
    // Preuve qu'aucune clé n'est énumérée à la main : une clé jamais vue
    // avant ce test produit exactement le même `principal` générique.
    const brut =
      "Le paramètre « une_cle_totalement_inedite_jamais_vue » n'est pas défini. Renseignez-le dans Paramètres avant de continuer.";
    const resultat = messageErreurAffichable(brut);
    expect(resultat.principal).toBe(
      messageErreurAffichable(MESSAGE_PARAMETRE_MANQUANT_BRUT).principal,
    );
    expect(resultat.detailTechnique).toBe(brut);
  });

  it('laisse INCHANGÉ un message métier hors de cette classe (déjà actionnable à la source)', () => {
    // Même registre que le refus d'annulation d'une réception déjà
    // consommée (`packages/db/src/services/mouvements.ts`) : ce message est
    // déjà écrit en français actionnable, il ne doit RIEN perdre.
    const brut =
      'Farine T55 : il ne reste que 200 g sur ce lot, pour une entrée de 500 g. ' +
      'Annuler cette entrée ferait passer le stock sous zéro : cette matière a déjà été ' +
      'réellement consommée (production, vente ou destruction), elle ne peut pas être ' +
      '« désreçue ». Corrigez plutôt la consommation qui en a disposé, ou passez par un ' +
      "ajustement d'inventaire.";
    const resultat = messageErreurAffichable(brut);
    expect(resultat.principal).toBe(brut);
    expect(resultat.detailTechnique).toBeNull();
  });

  it('ne confond pas un message qui PARLE d’un paramètre sans être ce message précis', () => {
    // Un message métier qui mentionne incidemment un paramètre ne doit pas
    // être aspiré par la classe générique : seul le message FIXE et complet
    // déclenche la relégation.
    const brut = 'Le paramètre « x » a été modifié par erreur, contactez le comptable.';
    const resultat = messageErreurAffichable(brut);
    expect(resultat.principal).toBe(brut);
    expect(resultat.detailTechnique).toBeNull();
  });
});

describe('MessageErreur — jamais le registre d’alerte MÉTIER (docs/07, le piège)', () => {
  it('ne porte NI le glyphe NI la couleur réservés à une alerte métier réelle', () => {
    const balisage = renderToStaticMarkup(<MessageErreur message="Erreur quelconque." />);
    expect(balisage).not.toContain('text-depassement');
    expect(balisage).not.toContain('bg-depassement-bg');
    expect(balisage).not.toContain('text-alerte');
    expect(balisage).not.toContain('bg-alerte-bg');
    // `role="alert"` reste légitime : c'est une annonce d'accessibilité, pas
    // le registre visuel réservé aux alertes métier.
    expect(balisage).toContain('role="alert"');
  });

  it('affiche le détail technique en second plan quand la classe est reconnue', () => {
    const balisage = renderToStaticMarkup(
      <MessageErreur message={MESSAGE_PARAMETRE_MANQUANT_BRUT} />,
    ).replace(/&#x27;/g, "'");
    expect(balisage).toContain('npm run db:seed');
    expect(balisage).toContain('echeance_e604b_tolerance_cents');
    // La phrase générique apparaît AVANT le détail technique dans le
    // balisage : c'est ce qui garantit qu'elle est lue en premier.
    const indexPrincipal = balisage.indexOf('npm run db:seed');
    const indexDetail = balisage.indexOf('echeance_e604b_tolerance_cents');
    expect(indexPrincipal).toBeGreaterThanOrEqual(0);
    expect(indexDetail).toBeGreaterThan(indexPrincipal);
  });

  it('n’affiche AUCUN second bloc quand aucun détail technique n’existe', () => {
    const balisage = renderToStaticMarkup(<MessageErreur message="Erreur quelconque." />);
    expect(balisage).not.toContain('text-2xs');
  });
});

describe('EncartErreur — l’encart garde son titre, son cadre et sa place', () => {
  it('rend le TITRE du panneau, jamais un bandeau nu à sa place', () => {
    const balisage = renderToStaticMarkup(
      <EncartErreur titre="Seuils légaux" message="Erreur quelconque." />,
    );
    expect(balisage).toContain('Seuils légaux');
    // Le titre est un `<h2>` du `Panneau` (voir `Panneau.tsx`), pas un simple
    // texte perdu dans le message d'erreur.
    expect(balisage).toMatch(/<h2[^>]*>Seuils légaux<\/h2>/);
  });

  it('deux titres différents produisent deux balisages distincts (le titre n’est jamais perdu)', () => {
    const premier = renderToStaticMarkup(
      <EncartErreur titre="Seuils légaux" message="Erreur quelconque." />,
    );
    const second = renderToStaticMarkup(
      <EncartErreur titre="À traiter" message="Erreur quelconque." />,
    );
    expect(premier).not.toBe(second);
    expect(second).toContain('À traiter');
    expect(second).not.toContain('Seuils légaux');
  });
});
