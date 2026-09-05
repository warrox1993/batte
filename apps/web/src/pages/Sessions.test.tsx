import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  GLYPHE_STATUT,
  TIRET_ABSENT,
  formaterEuros,
  formaterMontant,
  formaterPourcent,
  type CompteurSeuilContrat,
  type EcartStockVente,
} from '@batte/core';
import { Tableau } from '../composants/Tableau';
import {
  AnalyseEcartClaude,
  COLONNES_SEUILS,
  LIBELLE_ECOULEMENT,
  LienJustificatifFrais,
  PastilleStatutSession,
  affichageStatutSession,
  formaterAvertissementEcartsStock,
  formaterAvertissementFraisDetailIncomplet,
  formaterAvertissementReleveTemperatureAbsent,
  formaterCoutAppelIa,
  formaterKmPourSaisie,
  libelleFraisAffiche,
  parserDistanceReelleOptionnelle,
  raisonIndisponibleAnalyseEcart,
  titreEcoulement,
} from './Sessions';
import {
  LIBELLE_ECOULEMENT as LIBELLE_ECOULEMENT_TABLEAU_DE_BORD,
  titreEcoulement as titreEcoulementTableauDeBord,
} from './TableauDeBord';

/**
 * `affichageStatutSession` (audit visuel du 30/07/2026,
 * `docs/23-AUDIT-VISUEL.md` §3.2) : le défaut mesuré était une session
 * « planifiée » — un futur normal, zéro action requise — affichée avec le
 * même glyphe ▲ que les vraies alertes du tableau de bord (rupture de
 * stock, DLC proche). `planifiee` doit rendre un résultat NEUTRE, distinct
 * des trois entrées de `Statut` ; c'est la fonction PURE derrière ce choix,
 * testée directement, sans passer par l'écran. Le montage réel de `Sessions`
 * vit dans `Sessions.montage.test.tsx`, à côté de ce fichier.
 */
describe('affichageStatutSession — « planifiée » est neutre, jamais une alerte', () => {
  it('rend `planifiee` neutre — aucun des trois états du vocabulaire canonique', () => {
    expect(affichageStatutSession('planifiee')).toEqual({ neutre: true });
  });

  // Test RETIRÉ le 01/08/2026 avec l'état `'en_cours'` lui-même : il vérifiait
  // le rendu d'un statut qu'aucun chemin d'écriture ne pouvait produire, et que
  // `CLAUDE.md` §1 rend structurellement impossible (« aucun usage sur le stand
  // pendant le marché »). Un test vert sur une situation impossible ne prouve
  // rien — c'est le sixième cas de cette classe trouvé aujourd'hui.

  it('rend `cloturee` comme conforme', () => {
    expect(affichageStatutSession('cloturee')).toEqual({ neutre: false, statut: 'conforme' });
  });

  it('rend `annulee` comme un dépassement — écriture d’annulation, jamais une suppression', () => {
    expect(affichageStatutSession('annulee')).toEqual({ neutre: false, statut: 'depassement' });
  });
});

/**
 * `PastilleStatutSession` — vérifie le MARKUP RÉELLEMENT PRODUIT
 * (`renderToStaticMarkup`, même garde que `LienJustificatifFrais` plus bas) :
 * la décision `affichageStatutSession` ci-dessus ne prouve rien si le
 * composant ne la respecte pas. C'est ce test-ci, et pas le précédent, qui
 * aurait échoué sur le code d'avant cette mission (`statutAffichageSession`
 * mappait `planifiee` sur `'alerte'`, donc `PastilleStatutSession` rendait
 * bien le glyphe ▲ orange pour une session planifiée).
 */
describe('PastilleStatutSession — le glyphe ▲ ne doit jamais orner un futur normal', () => {
  it('« planifiee » : ni glyphe ▲, ni couleur d’alerte — juste le libellé en texte neutre', () => {
    const balisage = renderToStaticMarkup(<PastilleStatutSession statut="planifiee" />);
    expect(balisage).not.toContain(GLYPHE_STATUT.alerte);
    expect(balisage).not.toContain('text-alerte');
    expect(balisage).toContain('Planifiée');
  });

  it('« cloturee » : glyphe ● et couleur conforme', () => {
    const balisage = renderToStaticMarkup(<PastilleStatutSession statut="cloturee" />);
    expect(balisage).toContain(GLYPHE_STATUT.conforme);
    expect(balisage).toContain('text-conforme');
  });

  it('« annulee » : glyphe ■ et couleur de dépassement — jamais une suppression', () => {
    const balisage = renderToStaticMarkup(<PastilleStatutSession statut="annulee" />);
    expect(balisage).toContain(GLYPHE_STATUT.depassement);
    expect(balisage).toContain('text-depassement');
  });
});

/**
 * Le taux de vendu/produit portait trois habillages différents selon
 * l'écran avant cette mission (audit visuel du 30/07/2026,
 * `docs/23-AUDIT-VISUEL.md` §3.1) : « ÉCOULEMENT » en entier sur le Tableau
 * de bord (tronqué par CSS à largeur étroite, `ÉCOULE…`), « ÉCOUL. » ici
 * même sur Sessions.
 *
 * `LIBELLE_ECOULEMENT` et `titreEcoulement` vivaient dupliqués À L'IDENTIQUE
 * dans les deux fichiers (aucun module commun n'était dans le périmètre
 * d'écriture de cette mission-là), et ce test comparait les deux modules
 * pour garantir qu'ils ne redivergent pas silencieusement. Consolidés
 * depuis dans `packages/core/src/affichage.ts` (mission du 31/07/2026,
 * testés directement là-bas) et ré-exportés ici : `Sessions.tsx` et
 * `TableauDeBord.tsx` importent désormais la MÊME liaison, donc le dernier
 * test ci-dessous (« reste identique... ») est devenu une tautologie
 * garantie par construction — il ne peut plus jamais échouer, faute d'une
 * seconde définition qui pourrait diverger. Conservé quand même comme
 * documentation de l'invariant : les deux écrans doivent parler le même
 * mot.
 */
describe('LIBELLE_ECOULEMENT / titreEcoulement — un seul habillage, partagé avec TableauDeBord.tsx', () => {
  it('« Écoul. » : abréviation courte et stable, jamais de troncature à points de suspension', () => {
    expect(LIBELLE_ECOULEMENT).toBe('Écoul.');
    expect(LIBELLE_ECOULEMENT).not.toContain('…');
  });

  it("l'infobulle commence par le texte réellement rendu dans la cellule, puis nomme le mot entier", () => {
    expect(titreEcoulement(8953)).toBe(
      `${formaterPourcent(8953)} — Taux d'écoulement (vendu / produit)`,
    );
  });

  it('sur une valeur absente (`null`), l’infobulle commence par le même tiret que la cellule', () => {
    expect(titreEcoulement(null)).toBe(`${TIRET_ABSENT} — Taux d'écoulement (vendu / produit)`);
  });

  it('reste identique au libellé et à l’infobulle de TableauDeBord.tsx — même chiffre, même mot', () => {
    expect(LIBELLE_ECOULEMENT).toBe(LIBELLE_ECOULEMENT_TABLEAU_DE_BORD);
    expect(titreEcoulement(8953)).toBe(titreEcoulementTableauDeBord(8953));
    expect(titreEcoulement(null)).toBe(titreEcoulementTableauDeBord(null));
  });
});

/**
 * Kilomètres réels de la tournée à la clôture (D-064, mission du 30/07/2026) :
 * « tu dois laisser libre ce champ afin que je puisse par exemple aller du
 * marché à un autre marché ou chez des fournisseurs » (le porteur). Pas
 * d'interrupteur aller-retour, un champ libre, pré-rempli à 2× la distance de
 * référence du lieu.
 *
 * `parserDistanceReelleOptionnelle` est la fonction PURE extraite de
 * `cloturerSession()` : elle prouve, sans monter tout l'écran (ce fichier
 * teste des fonctions pures ; le montage vit dans
 * `Sessions.montage.test.tsx`), que la VIRGULE décimale belge est acceptée au même
 * titre que le point — ce champ se remplit à 23 h après un marché de six
 * heures et demie, ce n'est pas un détail — et qu'un champ vide reste `null`
 * (non renseigné), jamais 0 (CLAUDE.md §7 : une valeur inconnue vaut `null`,
 * jamais 0).
 */

describe('parserDistanceReelleOptionnelle — la virgule décimale belge', () => {
  it('accepte la virgule décimale (« 23,4 »)', () => {
    expect(parserDistanceReelleOptionnelle('23,4')).toBe(23.4);
  });

  it('accepte le point décimal (« 23.4 ») au même titre', () => {
    expect(parserDistanceReelleOptionnelle('23.4')).toBe(23.4);
  });

  it('accepte un entier sans décimale, le cas du pré-remplissage (2× une distance entière)', () => {
    expect(parserDistanceReelleOptionnelle('46')).toBe(46);
  });

  it('tolère les espaces autour de la saisie', () => {
    expect(parserDistanceReelleOptionnelle('  48,5  ')).toBe(48.5);
  });
});

describe('parserDistanceReelleOptionnelle — null veut dire non renseigné, jamais 0', () => {
  it('rend `null` sur un champ vide — jamais 0, qui laisserait croire à un déplacement gratuit', () => {
    expect(parserDistanceReelleOptionnelle('')).toBeNull();
  });

  it('rend `null` sur un champ ne contenant que des espaces', () => {
    expect(parserDistanceReelleOptionnelle('   ')).toBeNull();
  });
});

describe('parserDistanceReelleOptionnelle — refuse une saisie illisible', () => {
  it('rend `undefined` sur du texte qui ne se lit pas comme un nombre', () => {
    expect(parserDistanceReelleOptionnelle('abc')).toBeUndefined();
  });

  it('rend `undefined` sur une distance négative — une distance ne peut pas être négative', () => {
    expect(parserDistanceReelleOptionnelle('-12')).toBeUndefined();
  });
});

/**
 * `formaterKmPourSaisie` (D-074) : la distance de référence d'un lieu
 * (`lieu_marche.distance_km`) peut désormais porter une décimale — calculée
 * par OpenRouteService au dixième de km près, `apps/api/src/itineraire/
 * client.ts` — là où elle était toujours un compte rond avant ce correctif.
 * Le pré-remplissage des kilomètres réels (`distanceReferenceLieuKm * 2`, ci-
 * dessus dans `cloturerSession()`) doit donc afficher cette décimale avec la
 * même virgule française que le reste de l'écran, jamais un point anglo-saxon
 * qu'un `String(nombre)` brut aurait produit — et rester relisible par
 * `parserDistanceReelleOptionnelle` sans y toucher.
 */
describe('formaterKmPourSaisie — même virgule que le reste de l’écran (D-074)', () => {
  it('formate une décimale avec une virgule, jamais un point anglo-saxon', () => {
    expect(formaterKmPourSaisie(24.8)).toBe('24,8');
  });

  it('un compte rond ne gagne pas de décimale parasite', () => {
    expect(formaterKmPourSaisie(46)).toBe('46');
  });

  it('la valeur rendue reste relisible par `parserDistanceReelleOptionnelle`, sans perte', () => {
    expect(parserDistanceReelleOptionnelle(formaterKmPourSaisie(24.8))).toBe(24.8);
  });

  it('n’insère jamais de séparateur de milliers, qui rendrait la valeur illisible pour le parseur', () => {
    expect(formaterKmPourSaisie(1234.5)).toBe('1234,5');
    expect(parserDistanceReelleOptionnelle(formaterKmPourSaisie(1234.5))).toBe(1234.5);
  });
});

/**
 * `ecartsStock` (D-037) : calculé et renvoyé par `POST /sessions/:id/cloturer`
 * depuis longtemps, mais jamais affiché — aucune occurrence dans
 * `Sessions.tsx` avant cette mission (audit du 30/07/2026). L'écran suivait
 * fidèlement le chemin des deux frères `avertissementEnergie` et
 * `resolutionVolume` jusqu'au bandeau qui les montre ; celui d'`ecartsStock`
 * s'arrêtait juste avant.
 *
 * `formaterAvertissementEcartsStock` est la fonction PURE qui met en forme le
 * bandeau — extraite pour la même raison que `parserDistanceReelleOptionnelle`
 * ci-dessus : ce fichier ne monte pas l'écran (voir
 * `Sessions.montage.test.tsx` pour cela), mais la logique d'affichage reste
 * entièrement vérifiable sans lui.
 */
describe('formaterAvertissementEcartsStock — le signal doit être vu, jamais un bandeau vert à vide', () => {
  it(
    'rend `null` sur un tableau vide : PAS de bandeau « stock cohérent » affiché à chaque ' +
      'clôture — un bandeau identique à chaque session cesserait d’être lu, exactement le ' +
      'jour où il compterait',
    () => {
      expect(formaterAvertissementEcartsStock([])).toBeNull();
    },
  );

  it('nomme l’ingrédient et la quantité manquante quand un seul écart existe', () => {
    const ecarts: EcartStockVente[] = [
      { ingredientId: 'ing-1', nomIngredient: 'Sirop de Liège', quantiteManquante: 12 },
    ];
    const message = formaterAvertissementEcartsStock(ecarts);
    expect(message).not.toBeNull();
    expect(message).toContain('Sirop de Liège');
    expect(message).toContain('12');
  });

  it('liste chaque ingrédient séparément quand plusieurs écarts existent sur la même clôture', () => {
    const ecarts: EcartStockVente[] = [
      { ingredientId: 'ing-1', nomIngredient: 'Sirop de Liège', quantiteManquante: 12 },
      { ingredientId: 'ing-2', nomIngredient: 'Confiture de myrtilles', quantiteManquante: 3 },
    ];
    const message = formaterAvertissementEcartsStock(ecarts);
    expect(message).toContain('Sirop de Liège');
    expect(message).toContain('12');
    expect(message).toContain('Confiture de myrtilles');
    expect(message).toContain('3');
  });

  it(
    "n'invente aucune unité (g, ml, pièce) : `EcartStockVente` n'en porte pas, et cet écran " +
      'ne charge pas la liste des ingrédients pour la déduire',
    () => {
      const ecarts: EcartStockVente[] = [
        { ingredientId: 'ing-1', nomIngredient: 'Sirop de Liège', quantiteManquante: 12 },
      ];
      const message = formaterAvertissementEcartsStock(ecarts);
      expect(message).not.toMatch(/12\s?(g|kg|ml|L|pièces?)\b/);
    },
  );

  it(
    "n'invente aucune cause : le message renvoie à VÉRIFIER une réception ou l'inventaire, " +
      'jamais à AFFIRMER laquelle des deux explique cet écart précis',
    () => {
      const ecarts: EcartStockVente[] = [
        { ingredientId: 'ing-1', nomIngredient: 'Sirop de Liège', quantiteManquante: 12 },
      ];
      const message = formaterAvertissementEcartsStock(ecarts);
      expect(message).toMatch(/vérifiez/i);
    },
  );
});

/**
 * `formaterAvertissementReleveTemperatureAbsent` (mission AFSCA dédiée,
 * audit du 30/07/2026) : un audit parti d'une base vierge a trouvé que les
 * relevés de température sont facultatifs à la clôture (docs/17 fiche 17,
 * chaîne du froid PASSIVE — CLAUDE.md §6) et qu'une session close sans eux
 * laissait le registre AFSCA silencieusement incomplet — visible seulement
 * des mois plus tard, en générant le registre imprimé
 * (`sessionsSansReleveTemperature`, `packages/db/src/services/afsca.ts`,
 * câblée dans `apps/api/src/documents/donnees.ts`), jamais au moment où le
 * thermomètre est encore sur la table.
 *
 * Fonction PURE extraite pour la même raison que ses trois frères
 * ci-dessus : elle se vérifie sans monter l'écran (le montage vit dans
 * `Sessions.montage.test.tsx`).
 */
describe('formaterAvertissementReleveTemperatureAbsent — le rappel doit se voir, jamais bloquer', () => {
  it(
    'rend le message quand AUCUN relevé (ni arrivée ni retour) n’a été saisi à la clôture ' +
      '— le trou réel que cette mission comble',
    () => {
      const message = formaterAvertissementReleveTemperatureAbsent(0);
      expect(message).not.toBeNull();
    },
  );

  it(
    'ne se déclenche PAS quand au moins un relevé existe : un seul (arrivée OU retour) ' +
      'suffit, même seuil que `sessionsSansReleveTemperature` (packages/db/src/services/afsca.ts)',
    () => {
      expect(formaterAvertissementReleveTemperatureAbsent(1)).toBeNull();
      expect(formaterAvertissementReleveTemperatureAbsent(2)).toBeNull();
    },
  );

  it(
    'rend `null` quand aucune clôture n’a encore été soumise (`null`) — jamais un ' +
      'faux signal avant qu’un vrai résultat n’existe',
    () => {
      expect(formaterAvertissementReleveTemperatureAbsent(null)).toBeNull();
    },
  );

  it('ne bloque rien et ne culpabilise pas : ne dit ni « obligatoire », ni « refusé », ni « erreur »', () => {
    const message = formaterAvertissementReleveTemperatureAbsent(0);
    expect(message).not.toMatch(/obligatoire|refus|erreur|interdit/i);
  });

  it(
    "n'affirme rien sur la conformité (CLAUDE.md §7 : l'application ne remplace pas " +
      "l'AFSCA) : ne dit ni « conforme », ni « non conforme », ni « infraction »",
    () => {
      const message = formaterAvertissementReleveTemperatureAbsent(0);
      expect(message).not.toMatch(/conform|infraction/i);
    },
  );

  it(
    "ne promet pas de rattrapage qui n'existe pas : le relevé ne se rattache qu'à sa " +
      'propre clôture (vérifié dans `RegistreAfsca.tsx` : aucun sélecteur de session sur ' +
      "le formulaire autonome, et `POST /sessions/:id/cloturer` ne s'exécute qu'une fois) " +
      "— le message dit que ce n'est plus possible, jamais qu'il suffit d'aller le saisir " +
      'ailleurs maintenant',
    () => {
      const message = formaterAvertissementReleveTemperatureAbsent(0);
      expect(message).toMatch(/ne permet pas de rattacher/i);
      expect(message).not.toMatch(/onglet|écran registre|rendez-vous/i);
    },
  );
});

/**
 * `fraisDetail` (Trou 5, docs/21-CHAMPS-NON-LUS.md §1.5) : `session_frais` est
 * un LEDGER distinct des cinq colonnes agrégées, et EN L'ÉTAT `cloturerSession`
 * écrit exactement une ligne par catégorie non nulle — la somme du détail
 * DEVRAIT donc toujours égaler le total affiché. `formaterAvertissementFraisDetailIncomplet`
 * est la fonction PURE qui VÉRIFIE cette égalité au centime (jamais ne la
 * suppose) et le dit explicitement quand elle ne tient pas — un détail qui ne
 * somme pas à son total est pire que pas de détail du tout, parce qu'on
 * cherche l'erreur ailleurs.
 *
 * Plusieurs lignes dans chaque cas (jamais une seule) : un agent a découvert
 * qu'un premier jet passait « même avec le bug » faute d'un jeu de données
 * couvrant plusieurs frais — voir la mission.
 */
describe('formaterAvertissementFraisDetailIncomplet — le détail doit sommer à son total, au centime', () => {
  it('rend `null` quand la somme de PLUSIEURS lignes égale exactement le total (le cas normal)', () => {
    const detail = [{ montantCents: 1500 }, { montantCents: 800 }, { montantCents: 250 }];
    expect(formaterAvertissementFraisDetailIncomplet(2550, detail)).toBeNull();
  });

  it('rend `null` sur un détail vide et un total nul (aucun frais, rien à expliquer)', () => {
    expect(formaterAvertissementFraisDetailIncomplet(0, [])).toBeNull();
  });

  it(
    'signale un total supérieur à la somme du détail (poste manquant), avec les deux montants ' +
      "et l'écart exact dérivé par SOUSTRACTION d'entiers — jamais recalculé par une part",
    () => {
      // 1500 + 800 = 2300, mais le total affiché est 3130 : 830 manquent.
      const detail = [{ montantCents: 1500 }, { montantCents: 800 }];
      const message = formaterAvertissementFraisDetailIncomplet(3130, detail);
      expect(message).not.toBeNull();
      expect(message).toContain('23,00');
      expect(message).toContain('31,30');
      expect(message).toContain('8,30');
    },
  );

  it('dit explicitement que le total ci-dessus reste la valeur de référence, pas la somme du détail', () => {
    const message = formaterAvertissementFraisDetailIncomplet(3130, [{ montantCents: 1500 }]);
    expect(message).toMatch(/reste la valeur de référence/i);
  });

  it(
    'signale aussi le cas inverse (détail supérieur au total, incohérence qui ne devrait ' +
      'jamais se produire) — jamais un silence sur une anomalie dans les deux sens',
    () => {
      const detail = [{ montantCents: 2000 }, { montantCents: 500 }];
      const message = formaterAvertissementFraisDetailIncomplet(2000, detail);
      expect(message).not.toBeNull();
      expect(message).toMatch(/dépasse/i);
      expect(message).toContain('5,00');
    },
  );

  it("ne modifie et ne recalcule jamais le total affiché : il n'apparaît qu'en argument, jamais recompose", () => {
    // Une session à 5 catégories, exactement le cas motivant la mission
    // (plusieurs frais « divers » potentiels) : 5 lignes, somme exacte.
    const detail = [
      { montantCents: 1200 }, // emplacement
      { montantCents: 3400 }, // deplacement
      { montantCents: 900 }, // gaz
      { montantCents: 250 }, // divers
      { montantCents: 40 }, // energie
    ];
    const total = 1200 + 3400 + 900 + 250 + 40;
    expect(formaterAvertissementFraisDetailIncomplet(total, detail)).toBeNull();
  });
});

/**
 * `libelleFraisAffiche` : aujourd'hui `ligne.libelle` EST la catégorie brute
 * (`cloturerSession` écrit `libelle: categorie`,
 * `packages/db/src/services/sessions.ts:1504`) — cette fonction ne fait que
 * traduire les cinq valeurs connues pour l'affichage, JAMAIS n'invente une
 * catégorie qui n'existe pas dans le contrat.
 */
describe('libelleFraisAffiche — traduit les catégories connues, ne masque jamais les autres', () => {
  it.each([
    ['emplacement', 'Emplacement'],
    ['deplacement', 'Déplacement'],
    ['gaz', 'Gaz'],
    ['divers', 'Divers'],
    ['energie', 'Énergie'],
  ])('traduit « %s » en « %s »', (libelle, attendu) => {
    expect(libelleFraisAffiche({ libelle })).toBe(attendu);
  });

  it(
    'rend le libellé BRUT tel quel pour une valeur inconnue — jamais écrasé par un libellé ' +
      'générique : le jour où une ligne porte un vrai texte libre (plusieurs « divers » ' +
      'distincts), ce texte doit rester lisible',
    () => {
      expect(libelleFraisAffiche({ libelle: 'Frigo appoint' })).toBe('Frigo appoint');
    },
  );
});

/**
 * `LienJustificatifFrais` : MÊME garde que `LienPieceJointe` (`Factures.tsx`,
 * `Factures.securite.test.tsx`) contre l'exécution d'une Data URI — verrouillée
 * ici par le MARKUP RÉELLEMENT PRODUIT (`renderToStaticMarkup` : un seul
 * rendu, dans l'état initial).
 */
describe('LienJustificatifFrais — la garde `download` contre l’exécution d’une Data URI', () => {
  it('porte `download` et le `href` exact, sans aucun `target`', () => {
    const justificatif = 'data:image/png;base64,AAAA';
    const balisage = renderToStaticMarkup(
      <LienJustificatifFrais justificatif={justificatif} identifiant="divers-frais-1" />,
    );

    expect(balisage).toContain('download="justificatif-frais-divers-frais-1"');
    expect(balisage).toContain(`href="${justificatif}"`);
    expect(balisage).not.toContain('target=');
  });

  it(
    'DÉFENSE EN PROFONDEUR : même si une Data URI hostile atteignait ce composant ' +
      '(en pratique bloquée bien avant, par `validerPieceJointe` côté serveur), le rendu reste ' +
      'un simple lien `href`/`download` — jamais un `dangerouslySetInnerHTML`, jamais un ' +
      '`iframe`, jamais un `srcDoc`',
    () => {
      const justificatifHostile = 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='; // <script>alert(1)</script>
      const balisage = renderToStaticMarkup(
        <LienJustificatifFrais justificatif={justificatifHostile} identifiant="divers-frais-2" />,
      );

      expect(balisage).toContain(`href="${justificatifHostile}"`);
      expect(balisage).not.toContain('<script>');
      expect(balisage).not.toContain('dangerouslySetInnerHTML');
      expect(balisage).not.toContain('<iframe');
      expect(balisage).not.toContain('srcDoc');
      expect(balisage.match(/<a /g)?.length).toBe(1);
    },
  );

  it('échappe l’identifiant dans le nom de fichier téléchargé (pas d’injection d’attribut)', () => {
    const identifiantHostile = 'divers"><script>alert(1)</script>';
    const balisage = renderToStaticMarkup(
      <LienJustificatifFrais
        justificatif="data:image/png;base64,AAAA"
        identifiant={identifiantHostile}
      />,
    );

    expect(balisage).not.toContain('<script>');
    expect(balisage).toContain('&quot;');
  });
});

/**
 * Panneau « Seuils légaux » — libellé « Caisse enregistreuse certifiée (SCE) »
 * (`docs/23-AUDIT-VISUEL.md` §5, fiche de correction du 31/07/2026).
 *
 * `CLAUDE.md` §6 et `docs/07-DOCTRINE-ERP-ET-DESIGN.md` §6.7 le désignent
 * comme le seuil le plus piégeux du produit : il bascule de 0 % à obligatoire
 * dès qu'une table apparaît sur le stand, sans lien avec le chiffre
 * d'affaires. Le voir coupé en « Caisse enregistreuse c… » est précisément le
 * cas où l'utilisateur ne peut pas deviner ce qu'on lui cache.
 *
 * ROUGE avant le correctif : la colonne `libelle` de `COLONNES_SEUILS`
 * utilisait la troncature `ellipse` par défaut (aucun `troncature` déclaré),
 * qui coupe le texte à la largeur de la colonne sans jamais le restituer au
 * clavier (`title` n'est qu'un confort souris — `Tableau.tsx`). Passée à
 * `troncature: 'repli'`, la valeur ne se coupe plus jamais : la rangée
 * s'agrandit à la place, exactement le traitement déjà appliqué à la colonne
 * IDENTIFIANTE des tableaux de référence (D-081, `docs/05-DECISIONS.md`).
 *
 * Vérifié par le MARKUP RÉELLEMENT PRODUIT, pas par la lecture du code : un
 * `troncature: 'ellipse'` laisse aussi le texte complet dans le DOM (CSS ne
 * fait que le couper VISUELLEMENT), donc un test qui ne regarderait que le
 * texte rendu passerait même sur le code d'avant cette mission — c'est
 * `data-troncature="repli"` et l'absence de la classe `truncate` qui
 * distinguent réellement les deux cas (`Tableau.tsx`).
 */
describe('COLONNES_SEUILS — le libellé du seuil SCE ne doit jamais se tronquer', () => {
  function seuil(overrides: Partial<CompteurSeuilContrat> = {}): CompteurSeuilContrat {
    return {
      cle: 'sce',
      libelle: 'Caisse enregistreuse certifiée (SCE)',
      realiseCents: 0,
      plafondCents: 2_500_000,
      partBp: 0,
      projectionFinAnneeCents: null,
      depassementProjete: false,
      // Tolérance e604B (01/08/2026) : `null` sur tout seuil AUTRE que la
      // franchise TVA — c'est le second étage du MÊME seuil (sortie à
      // 25 000 €, tolérance jusqu'à 27 500 €), jamais un cinquième seuil
      // indépendant. Un `null` ici est un fait, pas une valeur manquante.
      toleranceE604b: null,
      source: 'test',
      ...overrides,
    };
  }

  it('la colonne `libelle` porte `troncature: repli`, jamais l’ellipse par défaut', () => {
    const colonneLibelle = COLONNES_SEUILS.find((c) => c.cle === 'libelle');
    expect(colonneLibelle).toBeDefined();
    expect(colonneLibelle?.troncature).toBe('repli');
  });

  it('la somme des `largeur` de `COLONNES_SEUILS` fait exactement 100 (D-081)', () => {
    const somme = COLONNES_SEUILS.reduce((total, c) => total + Number.parseFloat(c.largeur), 0);
    expect(somme).toBeCloseTo(100, 5);
  });

  it(
    'ROUGE avant le correctif : le libellé SCE au complet apparaît dans une cellule marquée ' +
      '`data-troncature="repli"`, sans la classe `truncate` qui l’aurait coupé en CSS',
    () => {
      const balisage = renderToStaticMarkup(
        <Tableau
          colonnes={COLONNES_SEUILS}
          lignes={[seuil()]}
          cleLigne={(s) => s.cle}
          etatVide={<span>vide</span>}
        />,
      );

      expect(balisage).toContain('Caisse enregistreuse certifiée (SCE)');
      expect(balisage).toContain('data-troncature="repli"');

      // La cellule DU LIBELLÉ précisément (pas une autre) doit porter le
      // marqueur `repli` et pas `truncate` : on isole son <td> en cherchant le
      // fragment qui contient le texte, borné par les balises `<td` qui
      // l'encadrent — plus robuste qu'un simple `toContain` global si une
      // classe `truncate` apparaissait ailleurs dans la même rangée.
      const indexTexte = balisage.indexOf('Caisse enregistreuse certifiée (SCE)');
      const debutCellule = balisage.lastIndexOf('<td', indexTexte);
      const finCellule = balisage.indexOf('</td>', indexTexte);
      const cellule = balisage.slice(debutCellule, finCellule);

      expect(cellule).toContain('data-troncature="repli"');
      expect(cellule).not.toContain('truncate');
      expect(cellule).not.toContain('…');
    },
  );
});

/**
 * Colonne `realise` de `COLONNES_SEUILS` — second étage du régime de
 * franchise TVA (docs/07 §6.6, `docs/05-DECISIONS.md`).
 *
 * `CompteurSeuilEnrichi.toleranceE604b` (`packages/db/src/depots/sessions.ts`)
 * calcule déjà le plafond de tolérance de 27 500 € et son statut ; le contrat
 * HTTP le déclare. Rien à l'écran ne le montrait avant ce correctif.
 *
 * Rendu par `renderToStaticMarkup` : UN rendu, dans l'état initial.
 * CE QUE CES TESTS NE PROUVENT PAS : que `GET /seuils`
 * renvoie réellement ce champ en conditions réelles (couvert côté serveur
 * par `packages/db/src/seuils-parametrables.test.ts`), ni la largeur exacte
 * en pixels du texte replié — seulement que le balisage contient le
 * qualificatif de tolérance UNIQUEMENT sur la ligne « Franchise TVA », et
 * jamais comme une colonne ou une rangée séparée.
 */
describe('COLONNES_SEUILS — la tolérance e604B est un second étage, jamais un cinquième seuil', () => {
  function seuilAvecTolerance(
    statutTolerance: 'conforme' | 'alerte' | 'depassement',
  ): CompteurSeuilContrat {
    return {
      cle: 'seuil_franchise_tva_cents',
      libelle: 'Franchise TVA',
      realiseCents: 2_600_000,
      plafondCents: 2_500_000,
      partBp: 10_400,
      projectionFinAnneeCents: null,
      depassementProjete: false,
      toleranceE604b: { plafondCents: 2_750_000, statut: statutTolerance },
      source: 'test',
    };
  }

  function rendreLigne(seuil: CompteurSeuilContrat): string {
    return renderToStaticMarkup(
      <Tableau
        colonnes={COLONNES_SEUILS}
        lignes={[seuil]}
        cleLigne={(s) => s.cle}
        etatVide={<span>vide</span>}
      />,
    );
  }

  it("n'affiche rien sur les seuils SANS régime à deux étages (`toleranceE604b: null`)", () => {
    const balisage = rendreLigne({
      cle: 'seuil_sce_cents',
      libelle: 'Caisse enregistreuse certifiée (SCE)',
      realiseCents: 0,
      plafondCents: 2_500_000,
      partBp: 0,
      projectionFinAnneeCents: null,
      depassementProjete: false,
      toleranceE604b: null,
      source: 'test',
    });
    expect(balisage).not.toContain('tolérance');
  });

  it('affiche le plafond de tolérance (27 500 €) DANS LA MÊME cellule que le plafond de 25 000 €', () => {
    const balisage = rendreLigne(seuilAvecTolerance('conforme'));
    expect(balisage).toContain('tolérance');
    expect(balisage).toContain(formaterMontant(2_750_000));

    // La tolérance n'ajoute ni colonne ni rangée : elle doit apparaître DANS
    // la cellule qui affiche déjà le plafond de 25 000 € (colonne `realise`),
    // jamais ailleurs. On isole cette cellule par sa position dans le
    // balisage et on vérifie qu'elle porte les DEUX plafonds.
    const indexRealise = balisage.indexOf(formaterMontant(2_500_000));
    const finCelluleRealise = balisage.indexOf('</td>', indexRealise);
    const celluleRealise = balisage.slice(indexRealise, finCelluleRealise);
    expect(celluleRealise).toContain('tolérance');
  });

  it('la somme des largeurs de `COLONNES_SEUILS` reste exactement 100 (D-081) même après ce correctif', () => {
    const somme = COLONNES_SEUILS.reduce((total, c) => total + Number.parseFloat(c.largeur), 0);
    expect(somme).toBeCloseTo(100, 5);
  });
});

/**
 * `raisonIndisponibleAnalyseEcart` — mission du 31/07/2026 (même motif que
 * D-087) : `POST /ia/analyse-ecart/:id` (`apps/api/src/routes/ia.ts:81`) refuse tout
 * statut différent de `cloturee` avec un message précis ; cette fonction
 * traduit la MÊME règle côté écran, AVANT le clic, sur le même patron que
 * `BoutonDocument` pour le rapport de session (juste au-dessus dans le
 * panneau « Détail de la session »).
 */
describe('raisonIndisponibleAnalyseEcart — même garde-fou que le rapport de session', () => {
  it('rend `undefined` — disponible — pour une session clôturée', () => {
    expect(raisonIndisponibleAnalyseEcart('cloturee')).toBeUndefined();
  });

  it(
    'nomme le statut en français pour une session annulée — le seul autre cas atteignable ' +
      'depuis ce panneau (`ouvrirLectureSeule` envoie « planifiee »/« en_cours » ailleurs)',
    () => {
      expect(raisonIndisponibleAnalyseEcart('annulee')).toBe(
        "Cette session est en statut « Annulée » : l'analyse d'écart n'est disponible qu'après clôture.",
      );
    },
  );

  it(
    'nomme aussi « planifiee » et « en_cours », même si le panneau ne les atteint pas en ' +
      'pratique — la fonction ne doit pas supposer son seul appelant actuel',
    () => {
      expect(raisonIndisponibleAnalyseEcart('planifiee')).toContain('« Planifiée »');
    },
  );
});

/**
 * `formaterCoutAppelIa` (Sessions.tsx) — même phrase que son homonyme de
 * `ProchaineSession.tsx`, redéfinie ici à dessein (voir le commentaire
 * d'en-tête dans `Sessions.tsx` : aucune page n'en importe une autre en
 * production dans ce dépôt).
 */
describe('formaterCoutAppelIa (Sessions.tsx) — le coût se lit au moment de l’appel', () => {
  it('met le montant en euros dans la phrase', () => {
    expect(formaterCoutAppelIa(250)).toBe(`Coût de cet appel : ${formaterEuros(250)}.`);
  });
});

/**
 * `AnalyseEcartClaude` — rendu INITIAL uniquement : `renderToStaticMarkup`
 * n'exécute aucun `useEffect` ni gestionnaire d'événement — même limite déjà
 * documentée pour `PanneauPrixConcurrents`, `ProchaineSession.test.tsx`.
 *
 * Ce que ces tests PROUVENT : le panneau démarre INACTIF, jamais en train de
 * charger (aucun appel Claude déclenché au montage — CLAUDE.md §5, « jamais
 * un appel au chargement d'un écran ») ; le bouton est atteignable et
 * ACTIONNABLE quand la session est clôturée ; il est visible mais INERTE, et
 * DIT POURQUOI (`title`, `aria-disabled="true"`), quand elle ne l'est pas —
 * jamais un bouton silencieusement absent.
 *
 * Ce que ces tests NE PROUVENT PAS : que le clic déclenche bien
 * `POST /ia/analyse-ecart/:id` ; que la réponse `disponible: false` (clé
 * absente, plafond atteint) s'affiche comme la `raison` du serveur telle
 * quelle ; ni que changer de session RÉINITIALISE l'état affiché (le
 * `useEffect` clé sur `sessionId`). Ces trois comportements dépendent d'un
 * montage réel (mount + interaction) : ils relèvent de
 * `Sessions.montage.test.tsx`, à côté de ce fichier.
 */
describe('AnalyseEcartClaude — rendu initial, jamais d’appel au montage', () => {
  it('affiche le bouton actionnable et le texte d’explication quand la session est clôturée', () => {
    const balisage = renderToStaticMarkup(
      <AnalyseEcartClaude sessionId="s1" raisonIndisponible={undefined} />,
    );

    expect(balisage).toContain('Demander une analyse');
    expect(balisage).toContain('Claude peut proposer des hypothèses');
    expect(balisage).toContain('aria-disabled="false"');
    // Aucun appel n'est en cours ni reçu au premier rendu : ni le texte
    // d'attente, ni un commentaire, ni un coût ne doivent apparaître.
    expect(balisage).not.toContain('Claude réfléchit');
    expect(balisage).not.toContain('Coût de cet appel');
  });

  it(
    'ROUGE avant le correctif : reste visible mais INERTE, et EXPLIQUE pourquoi, quand la ' +
      'session n’est pas clôturée — jamais un bouton simplement absent ou silencieusement actif',
    () => {
      const raison =
        "Cette session est en statut « Annulée » : l'analyse d'écart n'est disponible qu'après clôture.";
      // `renderToStaticMarkup` échappe l'apostrophe (`&#x27;`) comme tout texte
      // HTML, aussi bien dans un nœud de texte que dans un attribut
      // (`title="…"`) — même décodage que `ProchaineSession.test.tsx` pour
      // `ExplicationPrevision`, sans quoi ce test échouerait sur un détail
      // d'échappement plutôt que sur le câblage qu'il doit prouver.
      const balisage = renderToStaticMarkup(
        <AnalyseEcartClaude sessionId="s1" raisonIndisponible={raison} />,
      ).replace(/&#x27;/g, "'");

      expect(balisage).toContain('Demander une analyse');
      expect(balisage).toContain(raison);
      expect(balisage).toContain('aria-disabled="true"');
      expect(balisage).toContain(`title="${raison}"`);
    },
  );
});
