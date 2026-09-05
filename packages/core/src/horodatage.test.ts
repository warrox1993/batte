import { describe, expect, it } from 'vitest';
import {
  ajouterHeures,
  ajouterJours,
  formaterDate,
  formaterDateHeure,
  formaterDateTableau,
  formaterJoursRestants,
  horodatageFichier,
  jourCivilBelge,
  jourDuNomHorodate,
  joursEntre,
} from './horodatage.js';

describe('jourCivilBelge', () => {
  it('rattache un instant du soir au bon jour civil belge', () => {
    // 2 aout 2026 a 22h30 UTC = 3 aout 00h30 a Bruxelles (heure d'ete, UTC+2).
    // Une session de marche datee au jour UTC serait decalee d'un jour.
    expect(jourCivilBelge('2026-08-02T22:30:00Z')).toBe('2026-08-03');
  });

  it('gere l heure d hiver (UTC+1)', () => {
    expect(jourCivilBelge('2026-01-15T23:30:00Z')).toBe('2026-01-16');
    expect(jourCivilBelge('2026-01-15T22:30:00Z')).toBe('2026-01-15');
  });

  it('rend le format AAAA-MM-JJ', () => {
    expect(jourCivilBelge('2026-07-26T12:00:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('formaterDate', () => {
  it('affiche au format belge jour/mois/annee', () => {
    expect(formaterDate('2026-07-26T12:00:00Z')).toBe('26/07/2026');
  });
});

describe('formaterDateHeure', () => {
  it('affiche la date belge et l heure sur 24h, minutes comprises', () => {
    // 26/07/2026 19:18 UTC = 21:18 a Bruxelles en heure d ete (UTC+2).
    expect(formaterDateHeure('2026-07-26T19:18:00Z')).toBe('26/07/2026 21:18');
  });

  it('applique le decalage d heure d hiver (UTC+1)', () => {
    expect(formaterDateHeure('2026-01-15T20:05:00Z')).toBe('15/01/2026 21:05');
  });

  it('traverse le passage a l heure d ete : une minute UTC fait sauter une heure locale', () => {
    // Nuit du 29 mars 2026 : a 01:00 UTC, l horloge belge passe de 01:59:59
    // CET directement a 03:00:00 CEST. L heure 02h locale n existe pas ce
    // jour-la (CLAUDE.md §3 regle 8).
    expect(formaterDateHeure('2026-03-29T00:59:00Z')).toBe('29/03/2026 01:59');
    expect(formaterDateHeure('2026-03-29T01:00:00Z')).toBe('29/03/2026 03:00');
  });

  it('traverse le passage a l heure d hiver : la meme heure locale se produit deux fois', () => {
    // Nuit du 25 octobre 2026 : l horloge belge recule de 03:00:00 CEST a
    // 02:00:00 CET. 02h30 locale existe deux fois, a une heure d ecart en UTC
    // — exactement le cas que le commentaire d `horodatageFichier` signale
    // comme sans consequence a la journee, mais qui doit rester distinct ici.
    expect(formaterDateHeure('2026-10-25T00:30:00Z')).toBe('25/10/2026 02:30');
    expect(formaterDateHeure('2026-10-25T01:30:00Z')).toBe('25/10/2026 02:30');
  });

  it('fait franchir le nouvel an a un horodatage de reveillon', () => {
    expect(formaterDateHeure('2026-12-31T23:30:00Z')).toBe('01/01/2027 00:30');
  });

  it('accepte un objet Date au lieu d une chaine ISO', () => {
    expect(formaterDateHeure(new Date('2026-07-26T19:18:00Z'))).toBe('26/07/2026 21:18');
  });
});

describe('ajouterHeures', () => {
  it('calcule la DLC d un lot de pate a 24 h', () => {
    // Duree issue du parametre `duree_conservation_pate_heures`, pas d'un litteral.
    expect(ajouterHeures('2026-08-01T08:00:00Z', 24)).toBe('2026-08-02T08:00:00.000Z');
  });

  it('rend un ISO 8601 UTC', () => {
    expect(ajouterHeures('2026-08-01T08:00:00Z', 3)).toMatch(/Z$/);
  });
});

describe('ajouterJours', () => {
  it('traverse un changement de mois', () => {
    expect(ajouterJours('2026-07-30', 3)).toBe('2026-08-02');
  });

  it('traverse un changement d annee', () => {
    expect(ajouterJours('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('accepte un delta negatif', () => {
    expect(ajouterJours('2026-08-02', -3)).toBe('2026-07-30');
  });

  it('reste correct au passage a l heure d ete', () => {
    // Dernier dimanche de mars 2026 : le 29. Un calcul naif en heures locales
    // sauterait ou dupliquerait un jour.
    expect(ajouterJours('2026-03-28', 2)).toBe('2026-03-30');
  });
});

describe('joursEntre', () => {
  it('compte les jours pour une alerte DLC', () => {
    expect(joursEntre('2026-07-26', '2026-07-29')).toBe(3);
  });

  it('rend un nombre negatif si la DLC est depassee', () => {
    expect(joursEntre('2026-07-29', '2026-07-26')).toBe(-3);
  });

  it('rend 0 le jour meme', () => {
    expect(joursEntre('2026-07-26', '2026-07-26')).toBe(0);
  });

  it('accepte des horodatages complets et ignore l heure', () => {
    expect(joursEntre('2026-07-26T23:00:00Z', '2026-07-27T01:00:00Z')).toBe(1);
  });
});

describe('formaterDateTableau', () => {
  it('omet l annee quand elle est celle de reference', () => {
    // Repeter « /2026 » sur quarante lignes est du bruit.
    expect(formaterDateTableau('2026-07-26T12:00:00Z', 2026)).toBe('26/07');
  });

  it('affiche l annee quand elle differe', () => {
    // L'omettre sur une ligne de l'an dernier serait une erreur de lecture.
    expect(formaterDateTableau('2025-12-31T12:00:00Z', 2026)).toBe('31/12/2025');
  });
});

describe('formaterJoursRestants', () => {
  it('compte les jours avant une DLC', () => {
    expect(formaterJoursRestants('2026-07-29', '2026-07-26', 14)).toBe('J-3');
  });

  it('dit « aujourd hui » le jour meme', () => {
    expect(formaterJoursRestants('2026-07-26', '2026-07-26', 14)).toBe("aujourd'hui");
  });

  it('signale une DLC deja depassee', () => {
    expect(formaterJoursRestants('2026-07-24', '2026-07-26', 14)).toBe('J+2');
  });

  it('se tait au-dela de l horizon', () => {
    // Afficher « J-180 » sur un sirop qui perime en 2027 serait du bruit.
    expect(formaterJoursRestants('2027-12-01', '2026-07-26', 14)).toBeNull();
  });

  it('parle encore a la limite exacte de l horizon', () => {
    expect(formaterJoursRestants('2026-08-09', '2026-07-26', 14)).toBe('J-14');
    expect(formaterJoursRestants('2026-08-10', '2026-07-26', 14)).toBeNull();
  });

  /**
   * `horizonJours` n'a PLUS de valeur par defaut (mission du 01/08/2026,
   * docs/29-VALEURS-EN-DUR.md §4) : un appelant DOIT choisir sa fenetre. Ce
   * test fige le cas concret qui a motive la correction — un lot a 11 jours de
   * sa DLC est DANS l'horizon du brief avant-marche (7 jours) ? Non. DANS
   * l'ancien defaut des ecrans (14 jours) ? Oui — deux reponses differentes a
   * la meme question, pour le meme lot, a la meme date.
   */
  it('la meme DLC repond differemment selon la fenetre demandee — le cas du lot a J-11', () => {
    expect(formaterJoursRestants('2026-08-06', '2026-07-26', 7)).toBeNull();
    expect(formaterJoursRestants('2026-08-06', '2026-07-26', 14)).toBe('J-11');
  });
});

describe('horodatageFichier', () => {
  it('produit un nom triable sans caractere interdit sous Windows', () => {
    const nom = horodatageFichier(new Date('2026-07-26T21:18:05Z'));
    expect(nom).toBe('20260726-2318');
    expect(nom).not.toMatch(/[:\\/*?"<>|]/);
  });

  it('nomme en heure BELGE et non en UTC', () => {
    // 19h01 heure belge d'ete = 17h01 UTC. Le nom doit porter l'heure que
    // l'operateur a vue sur sa montre, pas celle du meridien de Greenwich.
    expect(horodatageFichier(new Date('2026-07-28T17:01:00Z'))).toBe('20260728-1901');
  });

  it('ne date pas de la veille une sauvegarde faite apres minuit', () => {
    // LE defaut qui coutait cher : 00h30 heure belge le 29, soit 22h30 UTC le
    // 28. Nomme en UTC, le fichier s'appelait `20260728-2230` — « la
    // sauvegarde d'hier soir » designait alors le mauvais fichier.
    const nom = horodatageFichier(new Date('2026-07-28T22:30:00Z'));
    expect(nom).toBe('20260729-0030');
    expect(nom.slice(0, 8)).toBe(jourCivilBelge('2026-07-28T22:30:00Z').replaceAll('-', ''));
  });

  it('rend minuit en 00 et jamais en 24', () => {
    // `hour12: false` rend « 24 » sur certains locales : le tri alphabetique
    // du dossier de sauvegardes s'en trouverait fausse d'une journee.
    expect(horodatageFichier(new Date('2026-01-15T23:10:00Z'))).toBe('20260116-0010');
  });
});

describe('jourDuNomHorodate', () => {
  it('relit le jour civil ecrit dans un nom de sauvegarde', () => {
    expect(jourDuNomHorodate('batte-20260728-1901.sqlite')).toBe('2026-07-28');
  });

  it('rend null sur un nom qui ne suit pas la convention', () => {
    // Une purge ne doit JAMAIS supprimer un fichier dont elle ne sait pas lire
    // la date : dans un dossier de sauvegardes, le doute protege.
    expect(jourDuNomHorodate('copie-manuelle.sqlite')).toBeNull();
    expect(jourDuNomHorodate('batte-2026072-1901.sqlite')).toBeNull();
  });

  it('fait le tour complet avec horodatageFichier', () => {
    // Invariant : ce que la fonction ecrit, l'autre sait le relire — teste sur
    // l'instant courant plutot que sur une date figee.
    const maintenant = new Date();
    expect(jourDuNomHorodate(`batte-${horodatageFichier(maintenant)}.sqlite`)).toBe(
      jourCivilBelge(maintenant),
    );
  });
});
