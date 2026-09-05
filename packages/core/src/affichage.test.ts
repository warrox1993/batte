import { describe, expect, it } from 'vitest';
import {
  GLYPHE_STATUT,
  LIBELLE_ECOULEMENT,
  LIBELLE_ECOULEMENT_LONG,
  TIRET_ABSENT,
  avertissementCoutRevientInconnu,
  avertissementCoutsManquants,
  avertissementsReceptionAAfficher,
  formaterEcartMontant,
  formaterEcartPourcent,
  formaterEcartWatts,
  formaterPourcent,
  mentionCommandeSoldee,
  messageDetectionEconomie,
  ouTiret,
  statutParPlafond,
  statutStock,
  titreEcoulement,
} from './affichage.js';
import { formaterMontant } from './argent.js';

describe('ouTiret', () => {
  it('distingue une valeur absente d un zero', () => {
    // Pour l'AFSCA, un stock a zero et un stock jamais inventorie ne sont pas
    // la meme information : ils ne doivent pas s'afficher pareil.
    expect(ouTiret(0, formaterMontant)).toBe('0,00');
    expect(ouTiret(null, formaterMontant)).toBe(TIRET_ABSENT);
    expect(ouTiret(undefined, formaterMontant)).toBe(TIRET_ABSENT);
  });

  it('utilise le tiret cadratin et non le trait d union', () => {
    expect(TIRET_ABSENT).toBe('—');
    expect(TIRET_ABSENT).not.toBe('-');
  });
});

describe('formaterEcartPourcent', () => {
  it('affiche systematiquement le signe, y compris le plus', () => {
    expect(formaterEcartPourcent(320)).toBe('+3,2 %');
  });

  it('utilise le signe moins typographique et non le trait d union', () => {
    const resultat = formaterEcartPourcent(-140);
    expect(resultat).toBe('−1,4 %');
    expect(resultat).not.toContain('-');
  });

  it('separe le pourcentage par une espace insecable etroite', () => {
    // Une espace ordinaire autoriserait un retour a la ligne avant le %.
    expect(formaterEcartPourcent(500)).toContain(' ');
  });

  it('affiche +0,0 % sur un ecart nul plutot que rien', () => {
    expect(formaterEcartPourcent(0)).toBe('+0,0 %');
  });
});

describe('formaterEcartMontant', () => {
  it('signe les deux sens et omet le symbole', () => {
    // L'unite va dans l'en-tete de colonne, pas dans la cellule.
    expect(formaterEcartMontant(1250)).toBe('+12,50');
    expect(formaterEcartMontant(-1250)).toBe('−12,50');
  });
});

describe('formaterEcartWatts', () => {
  it('signe une marge positive (aucun risque de disjonction)', () => {
    // docs/21-CHAMPS-NON-LUS.md §2.1 : le cas SANS risque, jamais narre par
    // l'avertissement serveur, doit rester dicible cote ecran.
    expect(formaterEcartWatts(800)).toBe('+800 W');
  });

  it('signe une marge negative avec le signe moins typographique', () => {
    const resultat = formaterEcartWatts(-350);
    expect(resultat).toBe('−350 W');
    expect(resultat).not.toContain('-');
  });

  it('affiche +0 W sur une marge exactement nulle', () => {
    expect(formaterEcartWatts(0)).toBe('+0 W');
  });
});

describe('formaterPourcent', () => {
  it('n affiche aucune decimale par defaut', () => {
    // Un taux d'ecoulement a 89,53 % ne se decide pas autrement que 90 %.
    expect(formaterPourcent(8953)).toBe('90 %');
  });

  it('accepte des decimales quand la decision en depend', () => {
    expect(formaterPourcent(169, 2)).toBe('1,69 %');
  });
});

describe('statutParPlafond — une valeur qui monte vers une limite', () => {
  const ALERTE_80 = 8000;

  it('est conforme sous le palier d alerte', () => {
    expect(statutParPlafond(4_210_00, 25_000_00, ALERTE_80)).toBe('conforme');
  });

  it('passe en alerte a 80 % du plafond', () => {
    expect(statutParPlafond(20_000_00, 25_000_00, ALERTE_80)).toBe('alerte');
  });

  it('passe en depassement au plafond exact', () => {
    expect(statutParPlafond(25_000_00, 25_000_00, ALERTE_80)).toBe('depassement');
  });

  it('ne divise pas par un plafond nul', () => {
    expect(statutParPlafond(100, 0, ALERTE_80)).toBe('conforme');
  });

  it('respecte un palier d alerte different', () => {
    // Le palier vient du parametre `seuil_alerte_bp`, jamais d'un litteral.
    expect(statutParPlafond(20_000_00, 25_000_00, 9000)).toBe('conforme');
    expect(statutParPlafond(22_500_00, 25_000_00, 9000)).toBe('alerte');
  });
});

describe('statutStock — une quantite qui descend vers un plancher', () => {
  it('est conforme au-dessus du stock de securite', () => {
    expect(statutStock(21_000, 8000)).toBe('conforme');
  });

  it('alerte sous le stock de securite : il faut recommander', () => {
    expect(statutStock(4200, 8000)).toBe('alerte');
  });

  it('distingue la rupture du simple passage sous le seuil', () => {
    // « Il ne m'en reste plus » et « il faut recommander » ne demandent pas la
    // meme reaction : ce sont deux statuts differents.
    expect(statutStock(0, 8000)).toBe('depassement');
    expect(statutStock(1, 8000)).toBe('alerte');
  });

  it('signale une rupture meme sans stock de securite declare', () => {
    expect(statutStock(0, 0)).toBe('depassement');
  });

  it('n alerte pas quand aucun stock de securite n est defini', () => {
    // Sans seuil, on ne peut rien affirmer — donc on n'alerte pas.
    expect(statutStock(500, 0)).toBe('conforme');
  });

  it('alerte au passage exact sous le seuil, pas au seuil', () => {
    expect(statutStock(8000, 8000)).toBe('conforme');
    expect(statutStock(7999, 8000)).toBe('alerte');
  });
});

describe('GLYPHE_STATUT', () => {
  it('donne un glyphe distinct par statut', () => {
    // Canal redondant a la couleur : daltonisme et impression noir et blanc des
    // PDF destines au comptable et a l'AFSCA.
    const glyphes = Object.values(GLYPHE_STATUT);
    expect(new Set(glyphes).size).toBe(glyphes.length);
  });
});

describe('avertissementCoutsManquants', () => {
  it('ne dit rien quand le prix ET le cout matiere sont connus', () => {
    expect(
      avertissementCoutsManquants({ prixMoyenConnu: true, coutMatiereConnu: true }),
    ).toBeNull();
  });

  it('ne reclame QUE le prix quand seul le prix manque', () => {
    // Le test qui compte : avant, un seul drapeau couvrait les deux inconnues,
    // donc l'avertissement envoyait le porteur ressaisir une recette qu'il
    // venait de saisir. Nommer juste ce qui manque est la moitie du correctif.
    const message = avertissementCoutsManquants({
      prixMoyenConnu: false,
      coutMatiereConnu: true,
    });
    expect(message).not.toBeNull();
    expect(message).toContain('prix de vente');
    expect(message).not.toContain('recette');
  });

  it('ne reclame QUE la recette quand seul le cout matiere manque', () => {
    // C'est le cas dangereux : le prix etait connu, donc l'ancien drapeau valait
    // « couts disponibles », et un cout matiere inconnu partait a 0 — une
    // matiere GRATUITE dans la marge d'un lieu, capable de faire recommander le
    // mauvais emplacement.
    const message = avertissementCoutsManquants({
      prixMoyenConnu: true,
      coutMatiereConnu: false,
    });
    expect(message).not.toBeNull();
    expect(message).toContain('recette');
    expect(message).not.toContain('prix de vente');
  });

  it('reclame les deux quand les deux manquent', () => {
    const message = avertissementCoutsManquants({
      prixMoyenConnu: false,
      coutMatiereConnu: false,
    });
    expect(message).toContain('prix de vente');
    expect(message).toContain('recette');
  });
});

describe('avertissementCoutRevientInconnu', () => {
  it('nomme la recette pour un transforme, jamais un conditionnement d achat', () => {
    const message = avertissementCoutRevientInconnu('transforme');
    expect(message).toContain('recette');
    expect(message).not.toContain('achat');
  });

  it('nomme le conditionnement d achat pour un revendu, jamais une recette', () => {
    // C'est le cas dangereux symetrique de `avertissementCoutsManquants` :
    // un revendu n'a pas de recette a completer, lui reclamer une recette
    // enverrait le porteur au mauvais ecran (Recettes au lieu d'Ingredients).
    const message = avertissementCoutRevientInconnu('revendu');
    expect(message).toContain('achat');
    expect(message).not.toContain('recette');
  });

  /**
   * La TROISIEME cause (composant de nomenclature de vente sans prix,
   * mission du 01/08/2026) : nommer LE composant fautif, pas seulement la
   * classe de cause. Un avertissement qui n'aurait que « recette vide ou
   * ingredient sans conditionnement » enverrait chercher au mauvais endroit
   * pour un cafe dont la recette est deliberement vide (D-085).
   */
  it('nomme le composant de nomenclature de vente fautif quand la liste en porte un', () => {
    const message = avertissementCoutRevientInconnu('transforme', ['Gobelet carton']);
    expect(message).toContain('Gobelet carton');
    expect(message).not.toContain('recette');
  });

  it('nomme tous les composants fautifs quand plusieurs sont sans prix', () => {
    const message = avertissementCoutRevientInconnu('transforme', ['Gobelet carton', 'Café moulu']);
    expect(message).toContain('Gobelet carton');
    expect(message).toContain('Café moulu');
  });

  it('retombe sur le message generique (recette/achat) quand aucun composant fautif n est fourni', () => {
    expect(avertissementCoutRevientInconnu('transforme', [])).toContain('recette');
    expect(avertissementCoutRevientInconnu('revendu', [])).toContain('achat');
  });
});

describe('messageDetectionEconomie', () => {
  it('ne dit rien quand aucune reference n existe (SILENCE)', () => {
    // Le cas le plus frequent : premier achat de cet article chez ce
    // fournisseur, ou plusieurs formats actifs sans contenance pour trancher.
    // Rien a comparer, donc rien affiche — jamais un bandeau permanent.
    expect(
      messageDetectionEconomie({
        prixReferenceCents: null,
        economieUnitaireCents: null,
        economiePotentielle: false,
      }),
    ).toBeNull();
  });

  it('ne dit rien quand l ecart est nul (SILENCE)', () => {
    // Prix identique au meilleur prix deja connu : ni une economie ni une
    // alerte, donc rien de nouveau a signaler.
    expect(
      messageDetectionEconomie({
        prixReferenceCents: 1000,
        economieUnitaireCents: 0,
        economiePotentielle: false,
      }),
    ).toBeNull();
  });

  it('signale une economie potentielle sans jamais bloquer', () => {
    const message = messageDetectionEconomie({
      prixReferenceCents: 1000,
      economieUnitaireCents: 150,
      economiePotentielle: true,
    });
    expect(message).not.toBeNull();
    expect(message).toContain('Économie potentielle');
    expect(message).toContain('1,50');
    expect(message).toContain('10,00');
  });

  it('signale un prix plus eleve sans jamais bloquer ni l interdire', () => {
    // Le point non negociable de la mission : un prix plus eleve peut etre
    // parfaitement justifie. Le message le dit, il ne l'empeche pas — cette
    // fonction ne rend qu'une chaine, jamais un booleen de blocage.
    const message = messageDetectionEconomie({
      prixReferenceCents: 1000,
      economieUnitaireCents: -150,
      economiePotentielle: false,
    });
    expect(message).not.toBeNull();
    expect(message).toContain('plus élevé');
    expect(message).toContain('1,50');
    expect(message).toContain('justifié');
  });

  it('reste inchange quand franco de port et commande minimum sont absents', () => {
    // Retro-compatibilite : les appels existants ne fournissent pas encore
    // ces deux champs (docs/21-CHAMPS-NON-LUS.md §1.2, partiellement cable).
    const message = messageDetectionEconomie({
      prixReferenceCents: 1000,
      economieUnitaireCents: 150,
      economiePotentielle: true,
    });
    expect(message).not.toContain('franco de port');
    expect(message).not.toContain('commande minimum');
  });

  it('ajoute le franco de port et la commande minimum quand ils sont connus', () => {
    const message = messageDetectionEconomie({
      prixReferenceCents: 1000,
      economieUnitaireCents: 150,
      economiePotentielle: true,
      francoDePortCents: 5000,
      commandeMinimumCents: 3000,
    });
    expect(message).not.toBeNull();
    expect(message).toContain('franco de port à partir de 50,00');
    expect(message).toContain('commande minimum 30,00');
  });

  it('ne mentionne que la condition connue quand l autre est null', () => {
    const message = messageDetectionEconomie({
      prixReferenceCents: 1000,
      economieUnitaireCents: 150,
      economiePotentielle: true,
      francoDePortCents: null,
      commandeMinimumCents: 3000,
    });
    expect(message).not.toContain('franco de port');
    expect(message).toContain('commande minimum 30,00');
  });

  it('reste SILENCE (null) meme avec franco/commande connus si l ecart est nul', () => {
    // Les conditions du fournisseur ne ressuscitent jamais un message quand il
    // n'y a structurellement rien a comparer (meme garde que les deux
    // premiers tests de ce describe).
    expect(
      messageDetectionEconomie({
        prixReferenceCents: null,
        economieUnitaireCents: null,
        economiePotentielle: false,
        francoDePortCents: 5000,
        commandeMinimumCents: 3000,
      }),
    ).toBeNull();
  });
});

describe('avertissementsReceptionAAfficher', () => {
  it('ne dit rien sur une liste vide (SILENCE)', () => {
    // Le cas le plus frequent : aucun lot identifie par sa seule DLC. Jamais
    // de bandeau « tracabilite correcte » affiche a chaque reception.
    expect(avertissementsReceptionAAfficher([])).toBeNull();
  });

  it('rend les avertissements TELS QUELS, sans les modifier', () => {
    const texte =
      'Farine de froment T55 : identifié par sa seule DLC (2026-08-15), sans numéro de lot ' +
      'fournisseur — deux réceptions à cette même DLC resteraient indistinguables en cas de rappel.';
    expect(avertissementsReceptionAAfficher([texte])).toEqual([texte]);
  });

  it('rend plusieurs avertissements sans en perdre aucun', () => {
    const avertissements = ['Ingrédient A : …', 'Ingrédient B : …'];
    expect(avertissementsReceptionAAfficher(avertissements)).toEqual(avertissements);
  });
});

describe('mentionCommandeSoldee', () => {
  it('ne dit rien quand aucune commande n etait rattachee (SILENCE)', () => {
    expect(mentionCommandeSoldee(null)).toBeNull();
  });

  it('nomme la commande soldee', () => {
    expect(mentionCommandeSoldee('CMD-2026-0042')).toBe('Commande CMD-2026-0042 soldée.');
  });
});

/**
 * `LIBELLE_ECOULEMENT` / `LIBELLE_ECOULEMENT_LONG` / `titreEcoulement`
 * consolides ici (mission du 31/07/2026) : ils vivaient dupliques mot pour
 * mot dans `Sessions.tsx` et `TableauDeBord.tsx` faute de module commun
 * dans le perimetre d'ecriture de la mission qui les a introduits. Les deux
 * ecrans les REEXPORTENT desormais depuis ce module — voir
 * `Sessions.test.tsx` et `TableauDeBord.test.tsx`, dont la verification
 * croisee « reste identique entre les deux ecrans » devient de ce fait une
 * tautologie garantie par construction plutot qu'une protection contre une
 * divergence future : il n'existe plus qu'une seule definition possible.
 */
describe('LIBELLE_ECOULEMENT / LIBELLE_ECOULEMENT_LONG / titreEcoulement', () => {
  it('« Écoul. » : abreviation courte et stable, jamais une troncature a points de suspension', () => {
    expect(LIBELLE_ECOULEMENT).toBe('Écoul.');
    expect(LIBELLE_ECOULEMENT).not.toContain('…');
  });

  it('LIBELLE_ECOULEMENT_LONG nomme le mot entier derriere l abreviation', () => {
    expect(LIBELLE_ECOULEMENT_LONG).toBe("Taux d'écoulement (vendu / produit)");
  });

  it('titreEcoulement commence par la valeur rendue, puis nomme le mot entier', () => {
    expect(titreEcoulement(8953)).toBe(`${formaterPourcent(8953)} — ${LIBELLE_ECOULEMENT_LONG}`);
  });

  it('sur une valeur absente (`null`), l infobulle commence par le meme tiret que la cellule', () => {
    expect(titreEcoulement(null)).toBe(`${TIRET_ABSENT} — ${LIBELLE_ECOULEMENT_LONG}`);
  });
});
