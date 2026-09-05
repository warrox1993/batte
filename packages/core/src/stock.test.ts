import { describe, expect, it } from 'vitest';
import { ErreurMetier } from './erreurs.js';
import {
  avertissementDlcDejaDepassee,
  calculerCump,
  estPerime,
  lotsProchesDlc,
  ordonnerFefo,
  quantiteDisponible,
  repartirFefo,
  valoriserStock,
  valoriserStockPerime,
  type LotStock,
} from './stock.js';

const AUJOURDHUI = '2026-07-27';

function lot(partiel: Partial<LotStock> & { id: string }): LotStock {
  return {
    ingredientId: 'farine',
    numeroLotFournisseur: null,
    dateDlc: null,
    dateReception: '2026-07-01',
    quantiteRestante: 1000,
    prixUnitaireCents: 0.075,
    statut: 'disponible',
    ...partiel,
  };
}

/**
 * COPIE FIGÉE de l'implémentation de `valoriserStock` telle qu'elle existait
 * AVANT ce correctif — utilisée UNIQUEMENT pour prouver le rouge (mission :
 * « un test que tu n'as jamais vu échouer ne prouve rien »). Ne JAMAIS faire
 * évoluer cette fonction en même temps que `valoriserStock` : le jour où elle
 * bougerait avec l'implémentation réelle, elle cesserait de prouver quoi que
 * ce soit sur l'ancien comportement.
 */
function valoriserStockAncienneFormule(lots: readonly LotStock[]): number {
  let valeurCents = 0;
  for (const l of lots) {
    if (l.statut === 'detruit' || l.quantiteRestante <= 0) continue;
    valeurCents += l.quantiteRestante * l.prixUnitaireCents;
  }
  return Math.round(valeurCents);
}

describe('ordonnerFefo', () => {
  it('sort d abord ce qui périme le plus tôt', () => {
    const ordre = ordonnerFefo([
      lot({ id: 'c', dateDlc: '2026-09-01' }),
      lot({ id: 'a', dateDlc: '2026-07-29' }),
      lot({ id: 'b', dateDlc: '2026-08-15' }),
    ]);
    expect(ordre.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('place un lot SANS DLC en dernier, pas en premier', () => {
    // Une denree non perissable n'est jamais urgente : la garder ne coute rien,
    // alors que garder une denree datee la fait perimer.
    const ordre = ordonnerFefo([
      lot({ id: 'sans-dlc', dateDlc: null }),
      lot({ id: 'datee', dateDlc: '2027-01-01' }),
    ]);
    expect(ordre.map((l) => l.id)).toEqual(['datee', 'sans-dlc']);
  });

  it('départage deux DLC identiques par date de réception', () => {
    // Sans ce second critere, l'ordre dependrait de l'ordre de lecture SQL et
    // la tracabilite ne serait pas reproductible d'une execution a l'autre.
    const ordre = ordonnerFefo([
      lot({ id: 'recent', dateDlc: '2026-08-01', dateReception: '2026-07-20' }),
      lot({ id: 'ancien', dateDlc: '2026-08-01', dateReception: '2026-07-05' }),
    ]);
    expect(ordre.map((l) => l.id)).toEqual(['ancien', 'recent']);
  });

  it('ne modifie pas le tableau reçu', () => {
    const lots = [lot({ id: 'b', dateDlc: '2026-09-01' }), lot({ id: 'a', dateDlc: '2026-08-01' })];
    ordonnerFefo(lots);
    expect(lots.map((l) => l.id)).toEqual(['b', 'a']);
  });
});

describe('estPerime', () => {
  it('n est pas périmé le jour même de la DLC', () => {
    expect(estPerime(AUJOURDHUI, AUJOURDHUI)).toBe(false);
  });

  it('est périmé le lendemain de la DLC', () => {
    expect(estPerime('2026-07-26', AUJOURDHUI)).toBe(true);
  });

  it('n est jamais périmé sans DLC', () => {
    expect(estPerime(null, AUJOURDHUI)).toBe(false);
  });

  it('prend la date seule, sans avoir besoin d un LotStock complet', () => {
    // C'est exactement le cas de l'ecran Stock cote client (`LotDetail`) :
    // il n'a que `dateDlc`, jamais les autres champs d'un `LotStock`.
    expect(estPerime('2026-01-01', AUJOURDHUI)).toBe(true);
  });
});

describe('avertissementDlcDejaDepassee — second défaut : une DLC déjà passée entre sans un mot', () => {
  it('reproduit le cas réel : DLC du 01/01/2026 saisie à une réception du 01/08/2026', () => {
    // docs/27-PARCOURS-REJOUE.md §3.d : sept mois de retard, aucun avertissement
    // aujourd'hui. La fonction doit produire une phrase, pas `null`.
    const avertissement = avertissementDlcDejaDepassee('Café moulu', '2026-01-01', '2026-08-01');
    expect(avertissement).not.toBeNull();
    expect(avertissement).toContain('Café moulu');
    expect(avertissement).toContain('2026-01-01');
    expect(avertissement).toContain('212 jours'); // 31 (jan reste) ... compté ci-dessous
  });

  it('compte les jours de retard exactement (janvier→août = 212 jours en 2026, année non bissextile)', () => {
    const avertissement = avertissementDlcDejaDepassee('Ingrédient', '2026-01-01', '2026-08-01');
    // 2026-01-01 au 2026-08-01 : 31+28+31+30+31+30+31 = 212 jours.
    expect(avertissement).toContain('212 jours');
  });

  it('accorde le singulier à un seul jour de retard', () => {
    const avertissement = avertissementDlcDejaDepassee('Ingrédient', '2026-07-26', AUJOURDHUI);
    expect(avertissement).toContain('1 jour ');
    expect(avertissement).not.toContain('1 jours');
  });

  it('rend null quand la DLC n’est pas dépassée à la date de réception', () => {
    expect(avertissementDlcDejaDepassee('Ingrédient', '2026-08-15', AUJOURDHUI)).toBeNull();
  });

  it('rend null le jour même de la DLC — même convention que estPerime', () => {
    expect(avertissementDlcDejaDepassee('Ingrédient', AUJOURDHUI, AUJOURDHUI)).toBeNull();
  });

  it('rend null sans DLC saisie', () => {
    expect(avertissementDlcDejaDepassee('Ingrédient', null, AUJOURDHUI)).toBeNull();
  });

  it('NE PARLE JAMAIS DE REFUS : la phrase dit explicitement que la réception reste enregistrée', () => {
    // CLAUDE.md §7 : un lot livré périmé est un fait à tracer, pas à bloquer.
    const avertissement = avertissementDlcDejaDepassee('Ingrédient', '2026-01-01', '2026-08-01')!;
    expect(avertissement).toContain('réception reste enregistrée');
  });
});

describe('repartirFefo — invariant n°1 : un lot ne peut pas être surconsommé', () => {
  it('borne chaque allocation au restant du lot', () => {
    const resultat = repartirFefo(
      [
        lot({ id: 'a', dateDlc: '2026-07-29', quantiteRestante: 300 }),
        lot({ id: 'b', dateDlc: '2026-08-10', quantiteRestante: 500 }),
      ],
      600,
      AUJOURDHUI,
    );

    expect(resultat.allocations).toEqual([
      expect.objectContaining({ lotId: 'a', quantite: 300 }),
      expect.objectContaining({ lotId: 'b', quantite: 300 }),
    ]);
    for (const allocation of resultat.allocations) {
      expect(allocation.quantite).toBeGreaterThan(0);
    }
  });

  it('rend la quantité manquante au lieu d échouer sans chiffre', () => {
    // L'ecran de faisabilite doit pouvoir dire « il manque 1,2 kg ».
    const resultat = repartirFefo([lot({ id: 'a', quantiteRestante: 800 })], 2000, AUJOURDHUI);

    expect(resultat.quantiteManquante).toBe(1200);
    expect(resultat.allocations).toHaveLength(1);
    expect(resultat.allocations[0]?.quantite).toBe(800);
  });

  it('ne manque rien quand le stock suffit exactement', () => {
    const resultat = repartirFefo([lot({ id: 'a', quantiteRestante: 500 })], 500, AUJOURDHUI);
    expect(resultat.quantiteManquante).toBe(0);
  });

  it('refuse une quantité négative', () => {
    expect(() => repartirFefo([], -1, AUJOURDHUI)).toThrow(ErreurMetier);
  });
});

describe('repartirFefo — invariant n°2 : pas de sortie sur un lot périmé', () => {
  const perime = lot({ id: 'perime', dateDlc: '2026-07-20', quantiteRestante: 1000 });
  const bon = lot({ id: 'bon', dateDlc: '2026-08-20', quantiteRestante: 1000 });

  it('ignore un lot périmé par défaut', () => {
    const resultat = repartirFefo([perime, bon], 500, AUJOURDHUI);

    expect(resultat.allocations.map((a) => a.lotId)).toEqual(['bon']);
  });

  it('signale une pénurie plutôt que de servir du périmé', () => {
    const resultat = repartirFefo([perime], 500, AUJOURDHUI);

    expect(resultat.allocations).toHaveLength(0);
    expect(resultat.quantiteManquante).toBe(500);
  });

  it('accepte le périmé sur autorisation explicite, et le marque', () => {
    // L'appelant qui passe cette option DOIT enregistrer un motif sur le
    // mouvement : c'est la condition posee par l'invariant n°2.
    const resultat = repartirFefo([perime], 500, AUJOURDHUI, { autoriserDlcDepassee: true });

    expect(resultat.allocations).toHaveLength(1);
    expect(resultat.allocations[0]?.dlcDepassee).toBe(true);
  });

  it('ne marque pas comme périmé un lot encore bon servi sous la même option', () => {
    const resultat = repartirFefo([bon], 500, AUJOURDHUI, { autoriserDlcDepassee: true });
    expect(resultat.allocations[0]?.dlcDepassee).toBe(false);
  });
});

describe('repartirFefo — statut de lot', () => {
  it('ne consomme que les lots disponibles', () => {
    // Quarantaine, blocage et destruction sont des decisions explicites : la
    // FEFO ne doit jamais les contourner.
    const resultat = repartirFefo(
      [
        lot({ id: 'quarantaine', statut: 'quarantaine', dateDlc: '2026-07-28' }),
        lot({ id: 'bloque', statut: 'bloque', dateDlc: '2026-07-29' }),
        lot({ id: 'detruit', statut: 'detruit', dateDlc: '2026-07-30' }),
        lot({ id: 'ok', statut: 'disponible', dateDlc: '2026-09-01' }),
      ],
      500,
      AUJOURDHUI,
    );

    expect(resultat.allocations.map((a) => a.lotId)).toEqual(['ok']);
  });

  it('ignore un lot déjà épuisé', () => {
    const resultat = repartirFefo(
      [lot({ id: 'vide', quantiteRestante: 0 }), lot({ id: 'plein', quantiteRestante: 500 })],
      200,
      AUJOURDHUI,
    );
    expect(resultat.allocations.map((a) => a.lotId)).toEqual(['plein']);
  });
});

describe('repartirFefo — coût', () => {
  it('valorise chaque allocation au prix de SON lot, pas à une moyenne', () => {
    // C'est ce qui rend le cout de revient reel tracable jusqu'au lot
    // fournisseur, exigence de la comptabilite analytique de docs/01 §7.
    const resultat = repartirFefo(
      [
        lot({ id: 'cher', dateDlc: '2026-07-28', quantiteRestante: 100, prixUnitaireCents: 2 }),
        lot({ id: 'pas-cher', dateDlc: '2026-08-28', quantiteRestante: 100, prixUnitaireCents: 1 }),
      ],
      150,
      AUJOURDHUI,
    );

    expect(resultat.allocations[0]?.coutCents).toBe(200); // 100 x 2
    expect(resultat.allocations[1]?.coutCents).toBe(50); // 50 x 1
    expect(resultat.coutTotalCents).toBe(250);
  });

  it('rend un coût entier en centimes', () => {
    const resultat = repartirFefo(
      [lot({ id: 'a', quantiteRestante: 1000, prixUnitaireCents: 0.075 })],
      333,
      AUJOURDHUI,
    );
    expect(Number.isInteger(resultat.coutTotalCents)).toBe(true);
  });
});

describe('calculerCump — invariant n°6 : cohérence avec les lots restants', () => {
  it('pondère par la quantité restante, pas par le nombre de lots', () => {
    // 900 g a 1 c/g et 100 g a 2 c/g -> (900 + 200) / 1000 = 1,1 c/g,
    // et non la moyenne simple de 1 et 2 qui donnerait 1,5.
    const cump = calculerCump([
      lot({ id: 'a', quantiteRestante: 900, prixUnitaireCents: 1 }),
      lot({ id: 'b', quantiteRestante: 100, prixUnitaireCents: 2 }),
    ]);
    expect(cump).toBeCloseTo(1.1, 6);
  });

  it('rend null et non zéro quand le stock est épuisé', () => {
    // Zero ferait apparaitre une marge de 100 % sur la prochaine production.
    expect(calculerCump([])).toBeNull();
    expect(calculerCump([lot({ id: 'a', quantiteRestante: 0 })])).toBeNull();
  });

  it('exclut un lot détruit mais garde la quarantaine', () => {
    // Un lot detruit ne vaut plus rien ; un lot en quarantaine existe encore et
    // sera peut-etre debloque.
    const cump = calculerCump([
      lot({ id: 'detruit', statut: 'detruit', quantiteRestante: 1000, prixUnitaireCents: 99 }),
      lot({
        id: 'quarantaine',
        statut: 'quarantaine',
        quantiteRestante: 100,
        prixUnitaireCents: 3,
      }),
    ]);
    expect(cump).toBe(3);
  });

  it('reste cohérent avec la valorisation totale QUAND AUCUN LOT N’EST PÉRIMÉ', () => {
    // Invariant n°6 (docs/02) : CUMP x quantite restante == valeur du stock.
    // Ne tient QUE dans ce cas — voir le test de divergence ci-dessous, qui
    // mesure l'écart exact dès qu'un lot périmé existe encore en stock
    // (`valoriserStock` l'exclut désormais, `calculerCump` continue de
    // l'inclure : hors périmètre de cette mission, voir le commentaire de
    // `calculerCump` dans stock.ts).
    const lots = [
      lot({ id: 'a', quantiteRestante: 900, prixUnitaireCents: 1 }),
      lot({ id: 'b', quantiteRestante: 100, prixUnitaireCents: 2 }),
    ];
    const cump = calculerCump(lots)!;
    const quantiteTotale = 1000;
    expect(Math.round(cump * quantiteTotale)).toBe(valoriserStock(lots, AUJOURDHUI));
  });

  it('DIVERGE de la valorisation exploitable dès qu’un lot périmé subsiste — mesuré, pas nié', () => {
    // Le CUMP (inchangé) continue de compter le lot périmé dans sa moyenne ;
    // `valoriserStock` (corrigé) l'exclut. L'écart entre les deux vaut
    // EXACTEMENT `valoriserStockPerime` : rien ne disparaît, la valeur s'est
    // juste déplacée d'un total vers l'autre.
    const lots = [
      lot({ id: 'bon', quantiteRestante: 900, prixUnitaireCents: 1 }),
      lot({ id: 'perime', quantiteRestante: 100, prixUnitaireCents: 2, dateDlc: '2026-01-01' }),
    ];
    const cump = calculerCump(lots)!;
    const quantiteTotale = 1000;
    const valeurSelonCump = Math.round(cump * quantiteTotale); // compte encore le périmé : 1100
    const valeurExploitable = valoriserStock(lots, AUJOURDHUI); // 900, le périmé exclu
    const valeurPerimee = valoriserStockPerime(lots, AUJOURDHUI); // 200

    expect(valeurSelonCump).toBe(1100);
    expect(valeurExploitable).toBe(900);
    expect(valeurPerimee).toBe(200);
    expect(valeurSelonCump - valeurExploitable).toBe(valeurPerimee);
  });
});

describe('valoriserStock', () => {
  it('rend un entier de centimes', () => {
    const valeur = valoriserStock(
      [lot({ id: 'a', quantiteRestante: 4200, prixUnitaireCents: 0.075 })],
      AUJOURDHUI,
    );
    expect(Number.isInteger(valeur)).toBe(true);
    expect(valeur).toBe(315); // 4200 x 0,075 = 315 c = 3,15 €
  });

  it('rend zéro sur un stock vide', () => {
    expect(valoriserStock([], AUJOURDHUI)).toBe(0);
  });

  it('sans jourReference, dégrade PROPREMENT vers l’ancien comportement (pas d’exclusion, pas de plantage)', () => {
    // Seul appelant en production à un seul argument aujourd'hui :
    // `etatDuStock` (`packages/db/src/depots/stock.ts:279`), hors zone
    // d'écriture de cette mission. Ce test garantit qu'un appel non migré ne
    // plante jamais (`estPerime(dateDlc, undefined)` lèverait sinon) — voir
    // le commentaire de `valoriserStock` dans stock.ts pour le raisonnement
    // complet.
    const perime = lot({ id: 'perime', dateDlc: '2026-01-01', quantiteRestante: 200 });
    expect(() => valoriserStock([perime])).not.toThrow();
    expect(valoriserStock([perime])).toBe(valoriserStockAncienneFormule([perime]));
  });

  describe('invariant : la matière périmée n’est plus un actif exploitable', () => {
    // Reproduit le cas réel (docs/27-PARCOURS-REJOUE.md §3.b) : café moulu,
    // 200 g reçus avec une DLC déjà dépassée, 0 g disponible, mais 3,00 €
    // comptés quand même dans une valeur totale de 82,12 €.
    const bon = lot({
      id: 'bon',
      dateDlc: '2026-09-01',
      quantiteRestante: 500,
      prixUnitaireCents: 2,
    });
    const perime = lot({
      id: 'cafe-perime',
      dateDlc: '2026-01-01', // déjà passé au 2026-07-27 (AUJOURDHUI)
      quantiteRestante: 200,
      prixUnitaireCents: 3,
    });

    it('AVANT (reproduction du défaut) : l’ancienne formule compte le lot périmé plein tarif', () => {
      // `valoriserStockAncienneFormule` ci-dessous est un COPIÉ-COLLÉ exact de
      // l'implémentation d'avant ce correctif (seul `statut === 'detruit'`
      // exclu) — c'est la preuve du rouge, gelée, pour ne jamais dépendre de
      // l'implémentation actuelle qu'elle sert justement à contredire.
      expect(valoriserStockAncienneFormule([bon, perime])).toBe(1600); // (500x2)+(200x3)
    });

    it('APRÈS (le correctif) : la valeur AVEC le lot périmé == la valeur SANS lui', () => {
      const avecLotPerime = valoriserStock([bon, perime], AUJOURDHUI);
      const sansLotPerime = valoriserStock([bon], AUJOURDHUI);
      // Les deux chiffres demandés par la mission : avec, puis sans.
      expect(avecLotPerime).toBe(1000); // 500 x 2, le périmé (600) exclu
      expect(sansLotPerime).toBe(1000);
      expect(avecLotPerime).toBe(sansLotPerime);
    });

    it('la valeur périmée n’est jamais perdue : elle se retrouve intégralement dans valoriserStockPerime', () => {
      expect(valoriserStockPerime([bon, perime], AUJOURDHUI)).toBe(600); // 200 x 3
      // CLAUDE.md §7 : rien ne se minore. La somme des deux totaux retombe
      // exactement sur l'ancienne valorisation brute (tout ce qui n'est pas
      // détruit), preuve que la matière ne disparaît pas, elle change de case.
      expect(
        valoriserStock([bon, perime], AUJOURDHUI) + valoriserStockPerime([bon, perime], AUJOURDHUI),
      ).toBe(valoriserStockAncienneFormule([bon, perime]));
    });

    it('un lot DÉTRUIT reste exclu des deux totaux (aucun double compte)', () => {
      const detruit = lot({
        id: 'detruit',
        statut: 'detruit',
        dateDlc: '2026-01-01',
        quantiteRestante: 0,
        prixUnitaireCents: 99,
      });
      expect(valoriserStock([bon, detruit], AUJOURDHUI)).toBe(1000);
      expect(valoriserStockPerime([bon, detruit], AUJOURDHUI)).toBe(0);
    });
  });

  describe('piège symétrique : quarantaine et blocage ne sont PAS invendables en soi', () => {
    it('un lot en QUARANTAINE mais PAS périmé reste dans l’actif exploitable', () => {
      // La quarantaine est une matière EN ATTENTE DE VÉRIFICATION, pas perdue.
      // L'exclure serait aussi faux que d'y garder un lot périmé.
      const quarantaine = lot({
        id: 'q',
        statut: 'quarantaine',
        dateDlc: '2027-01-01',
        quantiteRestante: 100,
        prixUnitaireCents: 5,
      });
      expect(valoriserStock([quarantaine], AUJOURDHUI)).toBe(500);
      expect(valoriserStockPerime([quarantaine], AUJOURDHUI)).toBe(0);
    });

    it('un lot BLOQUÉ mais PAS périmé reste dans l’actif exploitable', () => {
      const bloque = lot({
        id: 'b',
        statut: 'bloque',
        dateDlc: '2027-01-01',
        quantiteRestante: 100,
        prixUnitaireCents: 5,
      });
      expect(valoriserStock([bloque], AUJOURDHUI)).toBe(500);
      expect(valoriserStockPerime([bloque], AUJOURDHUI)).toBe(0);
    });

    it('un lot en QUARANTAINE ET périmé bascule quand même en perte — la péremption prime', () => {
      const quarantaineEtPerimee = lot({
        id: 'qp',
        statut: 'quarantaine',
        dateDlc: '2026-01-01',
        quantiteRestante: 100,
        prixUnitaireCents: 5,
      });
      expect(valoriserStock([quarantaineEtPerimee], AUJOURDHUI)).toBe(0);
      expect(valoriserStockPerime([quarantaineEtPerimee], AUJOURDHUI)).toBe(500);
    });
  });
});

describe('quantiteDisponible', () => {
  it('exclut le périmé, la quarantaine, le blocage et la destruction', () => {
    const disponible = quantiteDisponible(
      [
        lot({ id: 'ok', quantiteRestante: 500 }),
        lot({ id: 'perime', quantiteRestante: 500, dateDlc: '2026-07-01' }),
        lot({ id: 'quarantaine', quantiteRestante: 500, statut: 'quarantaine' }),
        lot({ id: 'bloque', quantiteRestante: 500, statut: 'bloque' }),
        lot({ id: 'detruit', quantiteRestante: 500, statut: 'detruit' }),
      ],
      AUJOURDHUI,
    );
    expect(disponible).toBe(500);
  });
});

describe('lotsProchesDlc', () => {
  it('rend les lots urgents en premier, avec le compteur de jours', () => {
    const proches = lotsProchesDlc(
      [
        lot({ id: 'j10', dateDlc: '2026-08-06' }),
        lot({ id: 'j3', dateDlc: '2026-07-30' }),
        lot({ id: 'lointain', dateDlc: '2027-01-01' }),
        lot({ id: 'sans-dlc', dateDlc: null }),
      ],
      AUJOURDHUI,
      14,
    );

    expect(proches.map((p) => p.lot.id)).toEqual(['j3', 'j10']);
    expect(proches[0]?.joursRestants).toBe(3);
  });

  it('inclut un lot déjà périmé, avec un compteur négatif', () => {
    // Un lot perime en stock est une alerte, pas un silence.
    const proches = lotsProchesDlc([lot({ id: 'perime', dateDlc: '2026-07-25' })], AUJOURDHUI, 14);
    expect(proches[0]?.joursRestants).toBe(-2);
  });
});
