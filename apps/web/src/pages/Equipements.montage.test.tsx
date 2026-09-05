/**
 * Écran Équipements électriques — premier test MONTÉ de cet écran.
 *
 * ═══ Pourquoi ce fichier existe ═══
 *
 * `Equipements.tsx` était à **0 % de couverture** au 01/08/2026 : aucun test,
 * d'aucune sorte. Ce n'était pas un oubli isolé — cet écran ne contient AUCUNE
 * fonction pure exportée, donc rien qui puisse se tester sans DOM. Tout ce
 * qu'il décide (quatre chargements indépendants, trois états par panneau, la
 * distinction inconnu/zéro du diagnostic de disjonction) vit dans des
 * `useEffect` et des états React, hors de portée de `renderToStaticMarkup`.
 *
 * ═══ Ce que ce fichier couvre en priorité ═══
 *
 * 1. Les TROIS états d'un écran de lecture — chargement, erreur, liste vide —
 *    sur les quatre panneaux, qui échouent INDÉPENDAMMENT les uns des autres.
 * 2. La distinction inconnu / zéro (D-055 : « aucune valeur par défaut
 *    optimiste »). C'est le cœur métier de cet écran : une puissance
 *    disponible inconnue ne veut JAMAIS dire « pas de risque de disjonction »,
 *    et un point d'équilibre indisponible ne vaut JAMAIS « 0 session ».
 * 3. Le registre d'erreur : une panne technique n'emprunte pas la couleur
 *    d'alerte MÉTIER (`bg-depassement-bg`), corrigé sur 78 emplacements le
 *    01/08/2026.
 * 4. Le clavier (CLAUDE.md §3 règle 10) : sélectionner une ligne du tableau à
 *    Entrée, se déplacer aux flèches, et savoir OÙ le focus atterrit.
 *
 * ═══ Sur les fixtures ═══
 *
 * Elles sont volontairement DISCRIMINANTES : chaque jeu porte à la fois le cas
 * connu et le cas inconnu. Une fixture où toutes les puissances disponibles
 * sont renseignées ne prouverait rien sur l'affichage d'une puissance
 * inconnue — c'est exactement le « vert par absence » que ce dépôt traque.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  TIRET_ABSENT,
  formaterEcartWatts,
  formaterMontant,
  type DiagnosticPuissanceLieuContrat,
  type Equipement,
  type PointEquilibreAutoproductionLigne,
  type QuantitePhysiqueIngredientContrat,
} from '@batte/core';

// `ErreurApi` doit rester la VRAIE classe : plusieurs branches de l'écran font
// un `instanceof` dessus pour choisir entre le message du serveur et un repli
// générique. Une classe factice ferait passer tous les refus par le repli, et
// le test serait vert pour la mauvaise raison.
import type * as ApiReelle from '../lib/api';

// `typeof ApiReelle` plutôt que `typeof import('../lib/api')` : la règle
// `@typescript-eslint/consistent-type-imports` interdit l'annotation
// `import()` en ligne. Le `import type` ci-dessus est effacé à la
// compilation — il ne crée donc aucune référence de VALEUR dans la fabrique
// de `vi.mock`, que Vitest remonte en tête de fichier.
vi.mock('../lib/api', async (importerReel) => {
  const reel = await importerReel<typeof ApiReelle>();
  return { ...reel, requeteApi: vi.fn() };
});

const { ErreurApi, requeteApi } = await import('../lib/api');
const { default: Equipements } = await import('./Equipements');

const appel = vi.mocked(requeteApi);

/** Classe du registre d'alerte MÉTIER, celui qui doit rester rare. */
const CLASSE_ALERTE_METIER = 'bg-depassement-bg';

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures
   ═══════════════════════════════════════════════════════════════════════════ */

function equipement(partiel: Partial<Equipement> = {}): Equipement {
  return {
    id: 'eq-1',
    nom: 'Radiateur soufflant',
    type: 'chauffage',
    puissanceW: 1500,
    enService: true,
    notes: null,
    actif: true,
    nbUtilisations: 0,
    ...partiel,
  };
}

/**
 * TROIS lignes de diagnostic, une par valeur possible de `risqueDisjonction` :
 * `true` (ça disjoncte), `false` (ça tient, marge connue), `null` (puissance
 * disponible non renseignée — on ne sait pas). Une fixture qui n'en porterait
 * qu'une seule ne pourrait pas montrer que l'écran les DISTINGUE.
 */
const DIAGNOSTICS: DiagnosticPuissanceLieuContrat[] = [
  {
    lieuId: 'lieu-disjoncte',
    lieuNom: 'La Batte',
    puissanceRequiseW: 4500,
    puissanceDisponibleW: 3500,
    margeW: -1000,
    risqueDisjonction: true,
    avertissement: '1000 W de trop : le compteur de ce lieu disjonctera.',
  },
  {
    lieuId: 'lieu-tient',
    lieuNom: 'Marché de Noël de Verviers',
    puissanceRequiseW: 4500,
    puissanceDisponibleW: 6000,
    margeW: 1500,
    risqueDisjonction: false,
    avertissement: null,
  },
  {
    lieuId: 'lieu-inconnu',
    lieuNom: 'Fête médiévale de Franchimont',
    puissanceRequiseW: 4500,
    // Le cas qui compte : inconnu, JAMAIS 0.
    puissanceDisponibleW: null,
    margeW: null,
    risqueDisjonction: null,
    avertissement: null,
  },
];

/** Deux immobilisations : l'une avec un point d'équilibre, l'autre sans. */
const POINTS_EQUILIBRE: PointEquilibreAutoproductionLigne[] = [
  {
    immobilisationId: 'immo-panneaux',
    libelle: 'Panneaux solaires de la remorque',
    coutInstallationCents: 180000,
    sessionsAvantEquilibre: 42,
    raisonIndisponible: null,
  },
  {
    immobilisationId: 'immo-eolienne',
    libelle: 'Éolienne verticale 400 W',
    coutInstallationCents: 95000,
    // Inconnu, et il porte SA raison : jamais « 0 sessions ».
    sessionsAvantEquilibre: null,
    raisonIndisponible: 'Aucune session close ne permet encore de mesurer le coût évité.',
  },
];

const EMPREINTE: QuantitePhysiqueIngredientContrat[] = [
  {
    ingredientId: 'ing-farine',
    nom: 'Farine T55',
    categorie: 'farine',
    uniteReference: 'g',
    quantiteRecue: 25000,
  },
];

const AVERTISSEMENT_SOLAIRE =
  'Ce calcul ne compte ni le gaz de cuisson ni le chauffage : seulement l’éclairage, le froid actif et le terminal de paiement.';
const AVERTISSEMENT_CARBONE =
  'Aucune conversion en CO2 n’est faite ici : les facteurs d’émission sont des données réglementaires externes non sourcées dans ce projet.';

type ReponsesFeintes = {
  equipements?: unknown;
  diagnostic?: unknown;
  pointEquilibre?: unknown;
  empreinte?: unknown;
};

/**
 * Route chaque chemin vers sa réponse. Une valeur qui est une `Error` est
 * REJETÉE — c'est ce qui permet de faire échouer UN panneau sans toucher aux
 * trois autres, ce que l'écran est censé supporter (mode dégradé, CLAUDE.md §5).
 * Une réponse absente reste en attente pour toujours : c'est l'état
 * « chargement ».
 */
function feindre(reponses: ReponsesFeintes): void {
  appel.mockImplementation((chemin: string) => {
    const choisie =
      chemin === '/equipements'
        ? reponses.equipements
        : chemin === '/equipements/diagnostic-puissance'
          ? reponses.diagnostic
          : chemin === '/equipements/point-equilibre-autoproduction'
            ? reponses.pointEquilibre
            : chemin === '/equipements/empreinte-quantites-physiques'
              ? reponses.empreinte
              : undefined;
    if (choisie === undefined) return new Promise<never>(() => {});
    if (choisie instanceof Error) return Promise.reject(choisie);
    return Promise.resolve(choisie as never);
  });
}

function listeEquipements(equipements: Equipement[], puissanceTotaleEnServiceW: number): unknown {
  return { data: equipements, meta: { total: equipements.length, puissanceTotaleEnServiceW } };
}

/** Le jeu complet, tous panneaux servis — base des tests qui n'étudient pas un échec. */
function toutServi(equipements: Equipement[] = [equipement()]): ReponsesFeintes {
  return {
    equipements: listeEquipements(
      equipements,
      equipements
        .filter((e) => e.enService && e.actif)
        .reduce((somme, e) => somme + e.puissanceW, 0),
    ),
    diagnostic: {
      data: DIAGNOSTICS,
      meta: { puissanceRequiseW: 4500, nbEquipementsEnService: 3 },
    },
    pointEquilibre: {
      data: POINTS_EQUILIBRE,
      meta: {
        coutEnergieEviteParSessionCents: 430,
        nbSessionsPriseEnCompte: 12,
        raisonCoutEviteIndisponible: null,
        avertissement: AVERTISSEMENT_SOLAIRE,
      },
    },
    empreinte: {
      data: EMPREINTE,
      meta: {
        kilometresParcourus: 480,
        nbSessionsDistanceInconnue: 2,
        energieElectriqueKwh: 31.5,
        avertissementConversionCarbone: AVERTISSEMENT_CARBONE,
      },
    },
  };
}

beforeEach(() => {
  appel.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   1. Les trois états d'un écran de lecture
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Équipements — chargement, erreur, vide', () => {
  it('annonce chacun des quatre chargements en cours, plutôt qu’un écran muet', () => {
    // Aucune réponse : les quatre promesses restent en attente.
    feindre({});
    render(<Equipements />);

    expect(screen.getByText('Chargement des équipements…')).toBeInTheDocument();
    expect(screen.getByText('Calcul du diagnostic…')).toBeInTheDocument();
    expect(screen.getByText('Calcul du point d’équilibre…')).toBeInTheDocument();
    expect(screen.getByText('Calcul des quantités physiques…')).toBeInTheDocument();
  });

  it('affiche le message du serveur en cas d’échec, SANS la couleur d’alerte métier', async () => {
    feindre({
      equipements: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    render(<Equipements />);

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('Erreur inattendue du serveur (code HTTP 500).');
    // LE point du correctif du 01/08/2026 : une panne technique ne demande
    // aucun geste, elle n'emprunte donc pas le registre d'une rupture de stock.
    expect(message.className).not.toContain(CLASSE_ALERTE_METIER);
    expect(message.parentElement?.className ?? '').not.toContain(CLASSE_ALERTE_METIER);
  });

  it('garde le titre du panneau quand la liste échoue — on doit savoir QUEL encart est mort', async () => {
    feindre({
      equipements: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    render(<Equipements />);

    await screen.findByRole('alert');
    expect(screen.getByRole('heading', { name: 'Équipements' })).toBeInTheDocument();
  });

  it('un échec du diagnostic n’emporte PAS la liste : les panneaux sont indépendants', async () => {
    feindre({
      ...toutServi(),
      diagnostic: new ErreurApi('Erreur inattendue du serveur (code HTTP 500).', {
        code: 'erreur_inattendue',
        statut: 500,
      }),
    });
    render(<Equipements />);

    expect(
      await screen.findByText('Impossible de calculer le diagnostic de puissance pour le moment.'),
    ).toBeInTheDocument();
    // La liste, elle, a bien répondu et reste consultable (mode dégradé).
    expect(screen.getByText('Radiateur soufflant')).toBeInTheDocument();
    // Et les deux autres panneaux ne sont pas contaminés non plus.
    expect(screen.getByText('Panneaux solaires de la remorque')).toBeInTheDocument();
    expect(screen.getByText('Farine T55')).toBeInTheDocument();
  });

  it('liste vide au premier lancement : une phrase et une action, jamais un cadre nu', async () => {
    feindre({
      ...toutServi([]),
      equipements: listeEquipements([], 0),
    });
    render(<Equipements />);

    expect(await screen.findByText('Aucun équipement électrique')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer un équipement' })).toBeInTheDocument();
  });

  it('liste non vide mais entièrement masquée par le filtre : l’état vide nomme LE filtre', async () => {
    // Fixture discriminante : la liste n'est PAS vide (deux équipements
    // existent), c'est le filtre « retirés » qui la vide. Confondre les deux
    // enverrait l'utilisateur créer un équipement qu'il possède déjà.
    const retires = [
      equipement({ id: 'eq-1', nom: 'Ancien radiateur', actif: false }),
      equipement({ id: 'eq-2', nom: 'Ancienne guirlande', actif: false, type: 'eclairage' }),
    ];
    feindre({ ...toutServi(retires), equipements: listeEquipements(retires, 3000) });
    render(<Equipements />);

    expect(
      await screen.findByText(
        'Les 2 équipements enregistrés sont tous retirés, et le filtre les masque.',
      ),
    ).toBeInTheDocument();
    // Le texte du premier lancement ne doit surtout PAS apparaître ici.
    expect(screen.queryByText('Aucun équipement électrique')).not.toBeInTheDocument();

    // Et la réinitialisation les fait bien réapparaître.
    await userEvent.click(screen.getByRole('button', { name: 'Réinitialiser le filtre' }));
    expect(screen.getByText('Ancien radiateur')).toBeInTheDocument();
    expect(screen.getByText('Ancienne guirlande')).toBeInTheDocument();
  });

  it('l’état vide au singulier ne dit pas « 1 équipements »', async () => {
    const unSeul = [equipement({ actif: false })];
    feindre({ ...toutServi(unSeul), equipements: listeEquipements(unSeul, 0) });
    render(<Equipements />);

    expect(
      await screen.findByText("L'unique équipement enregistré est retiré, et le filtre le masque."),
    ).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Inconnu ≠ zéro — la doctrine ferme du dépôt (D-055)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Équipements — une inconnue ne se lit jamais comme un zéro', () => {
  it('une puissance disponible inconnue rend le tiret d’absence, jamais « 0 W »', async () => {
    feindre(toutServi());
    render(<Equipements />);

    const ligne = (await screen.findByText('Fête médiévale de Franchimont')).closest('li');
    expect(ligne).not.toBeNull();
    // DEUX tirets sur cette ligne, et c'est exact : la puissance disponible est
    // inconnue, donc le verdict de disjonction l'est aussi. Rien ne se devine
    // de l'un à l'autre.
    expect(within(ligne as HTMLElement).getAllByText(TIRET_ABSENT)).toHaveLength(2);
    expect(ligne?.textContent ?? '').not.toContain('0 W disponibles');
  });

  it('les DEUX lieux à puissance connue, eux, l’affichent — la fixture discrimine', async () => {
    feindre(toutServi());
    render(<Equipements />);

    const disjoncte = (await screen.findByText('La Batte')).closest('li');
    expect(disjoncte?.textContent ?? '').toContain('3500 W disponibles');
    const tient = screen.getByText('Marché de Noël de Verviers').closest('li');
    expect(tient?.textContent ?? '').toContain('6000 W disponibles');
  });

  it('un risque INCONNU reste neutre : ni la couleur du dépassement, ni celle du conforme', async () => {
    feindre(toutServi());
    render(<Equipements />);

    const inconnu = (await screen.findByText('Fête médiévale de Franchimont')).closest('li');
    const cellules = Array.from((inconnu as HTMLElement).querySelectorAll('span'));
    const classes = cellules.map((c) => c.className).join(' ');
    expect(classes).not.toContain('text-depassement');
    expect(classes).not.toContain('text-conforme');
    // Et aucun glyphe de statut ne s'affiche : un glyphe est un jugement.
    expect(inconnu?.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('un risque AVÉRÉ porte le dépassement et son glyphe, un risque écarté le conforme', async () => {
    feindre(toutServi());
    render(<Equipements />);

    const disjoncte = (await screen.findByText('La Batte')).closest('li');
    expect((disjoncte as HTMLElement).innerHTML).toContain('text-depassement');
    expect(disjoncte?.textContent ?? '').toContain('1000 W de trop');

    const tient = screen.getByText('Marché de Noël de Verviers').closest('li');
    expect((tient as HTMLElement).innerHTML).toContain('text-conforme');
    // `margeW` narrée, et pas seulement le booléen (docs/21 §2.1). Comparée au
    // FORMATEUR, jamais à un littéral tapé à la main : `formaterEcartWatts`
    // pose un signe moins typographique U+2212, pas un trait d'union.
    expect(tient?.textContent ?? '').toContain(`Marge de ${formaterEcartWatts(1500)}`);
  });

  it('un point d’équilibre indisponible dit POURQUOI, jamais « 0 sessions »', async () => {
    feindre(toutServi());
    render(<Equipements />);

    expect(
      await screen.findByText('Aucune session close ne permet encore de mesurer le coût évité.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('0 sessions')).not.toBeInTheDocument();
    // La ligne dont le point d'équilibre EST connu s'affiche, elle, en clair —
    // sans ce second cas, le test ne prouverait rien sur la distinction.
    expect(screen.getByText('42 sessions')).toBeInTheDocument();
  });

  it('un coût d’énergie évité inconnu affiche sa raison, jamais un montant nul', async () => {
    const base = toutServi();
    feindre({
      ...base,
      pointEquilibre: {
        data: POINTS_EQUILIBRE,
        meta: {
          coutEnergieEviteParSessionCents: null,
          nbSessionsPriseEnCompte: 0,
          raisonCoutEviteIndisponible:
            'Aucune session close n’a de coût d’énergie enregistré pour le moment.',
          avertissement: AVERTISSEMENT_SOLAIRE,
        },
      },
    });
    render(<Equipements />);

    const raison = await screen.findByText(
      'Aucune session close n’a de coût d’énergie enregistré pour le moment.',
    );
    // On scrute le BANDEAU qui porte cette phrase, pas la page entière : la
    // colonne « Coût d'installation » du tableau, elle, affiche légitimement
    // des montants (« 1 800,00 ») dont « 0,00 » est un fragment.
    const bandeau = raison.closest('div') as HTMLElement;
    expect(bandeau.textContent ?? '').toContain('Au bout de combien de sessions');
    // `formaterMontant(0)` vaut « 0,00 » : un coût à zéro produit 100 % de
    // marge, c'est le mensonge le plus traqué de ce dépôt.
    expect(bandeau.textContent ?? '').not.toContain(formaterMontant(0));
  });

  it('un coût d’énergie CONNU s’affiche via le formateur — la fixture discrimine', async () => {
    feindre(toutServi());
    render(<Equipements />);

    // `formaterMontant` passe par `Intl` : comparer à « 4,30 » tapé à la main
    // marcherait ici, mais casserait au premier montant à quatre chiffres
    // (espace insécable de groupement). On compare toujours via le formateur.
    expect(await screen.findByText(formaterMontant(430), { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/mesuré sur 12 sessions/)).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Les garde-fous TOUJOURS affichés (docs/demandes/17 §3.1, §4)
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Équipements — les avertissements réglementaires ne se perdent pas', () => {
  it('le garde-fou solaire et le garde-fou carbone sont rendus tels quels', async () => {
    feindre(toutServi());
    render(<Equipements />);

    expect(await screen.findByText(AVERTISSEMENT_SOLAIRE)).toBeInTheDocument();
    expect(screen.getByText(AVERTISSEMENT_CARBONE)).toBeInTheDocument();
  });

  it('le kilométrage annonce les sessions NON comptées : c’est un plancher, pas une mesure', async () => {
    feindre(toutServi());
    render(<Equipements />);

    expect(
      await screen.findByText(/2 session\(s\) sans distance connue, non comptée\(s\)/),
    ).toBeInTheDocument();
  });

  it('le compte d’équipements en service accompagne la somme en watts', async () => {
    feindre(toutServi([equipement({ puissanceW: 1500 })]));
    render(<Equipements />);

    // « 3 équipements EN SERVICE (1500 W) » : le compte vient du diagnostic,
    // la somme de la liste — deux routes distinctes, une seule phrase.
    const bandeau = await screen.findByText(/EN SERVICE/);
    expect(bandeau.textContent ?? '').toContain('3 équipements');
    expect(bandeau.textContent ?? '').toContain('1500 W');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. Le clavier — CLAUDE.md §3 règle 10
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Équipements — utilisable au clavier', () => {
  const DEUX = [
    equipement({ id: 'eq-1', nom: 'Radiateur soufflant' }),
    equipement({ id: 'eq-2', nom: 'Guirlande LED', type: 'eclairage', puissanceW: 40 }),
  ];

  it('une seule rangée est dans l’ordre de tabulation — « roving tabindex »', async () => {
    feindre({ ...toutServi(DEUX), equipements: listeEquipements(DEUX, 1540) });
    render(<Equipements />);

    await screen.findByText('Radiateur soufflant');
    const rangees = screen.getAllByRole('row').filter((r) => r.hasAttribute('tabindex'));
    expect(rangees).toHaveLength(2);
    expect(rangees.filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('Entrée sur une rangée la sélectionne et charge la fiche — sans souris', async () => {
    feindre({ ...toutServi(DEUX), equipements: listeEquipements(DEUX, 1540) });
    render(<Equipements />);

    await screen.findByText('Guirlande LED');
    const rangee = screen.getByText('Guirlande LED').closest('tr') as HTMLTableRowElement;
    rangee.focus();
    await userEvent.keyboard('{Enter}');

    expect(rangee).toHaveAttribute('aria-selected', 'true');
    // Le titre du panneau de fiche prend le nom de l'équipement choisi, et le
    // formulaire est rempli : c'est ce qui prouve que la sélection a « pris ».
    expect(screen.getByRole('heading', { name: 'Guirlande LED' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Guirlande LED')).toBeInTheDocument();
    expect(screen.getByDisplayValue('40')).toBeInTheDocument();
  });

  it('Espace sélectionne aussi — le geste appris ne change pas', async () => {
    feindre({ ...toutServi(DEUX), equipements: listeEquipements(DEUX, 1540) });
    render(<Equipements />);

    await screen.findByText('Radiateur soufflant');
    const rangee = screen.getByText('Radiateur soufflant').closest('tr') as HTMLTableRowElement;
    rangee.focus();
    await userEvent.keyboard(' ');

    expect(rangee).toHaveAttribute('aria-selected', 'true');
  });

  it('Flèche Bas déplace le FOCUS d’une rangée à l’autre, et ne boucle pas en bas', async () => {
    feindre({ ...toutServi(DEUX), equipements: listeEquipements(DEUX, 1540) });
    render(<Equipements />);

    await screen.findByText('Radiateur soufflant');
    const premiere = screen.getByText('Radiateur soufflant').closest('tr') as HTMLTableRowElement;
    const seconde = screen.getByText('Guirlande LED').closest('tr') as HTMLTableRowElement;

    premiere.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(seconde);

    // Pas de bouclage : buter en bas laisse le focus où il est (Excel fait de
    // même, et un téléport silencieux en haut de liste perdrait l'utilisateur).
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(seconde);
  });

  it('Ctrl+S enregistre sans passer par la souris, et signale la saisie fautive', async () => {
    feindre({ ...toutServi(DEUX), equipements: listeEquipements(DEUX, 1540) });
    render(<Equipements />);

    await screen.findByText('Radiateur soufflant');
    // Le focus part d'un AUTRE champ que celui attendu à l'arrivée, sans quoi
    // l'assertion finale serait vraie sans que rien ne se soit passé.
    const notes = document.querySelector('[name="notes"]') as HTMLInputElement;
    notes.focus();
    expect(document.activeElement).toBe(notes);

    // Formulaire vierge (aucune sélection) : le schéma partagé doit refuser, et
    // le champ fautif doit prendre le focus — c'est là que le clavier se juge.
    const nombreAppelsAvant = appel.mock.calls.length;
    await userEvent.keyboard('{Control>}s{/Control}');

    expect(document.activeElement).toHaveAttribute('name', 'nom');
    // Rien n'est parti au serveur : la validation locale rejoue le même schéma.
    expect(appel.mock.calls.length).toBe(nombreAppelsAvant);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. L'état d'enregistrement PENDANT la requête (docs/39 §3, cinquième forme)
   ═══════════════════════════════════════════════════════════════════════════

   `feindre` (ci-dessus) ne sert que des lectures, toujours par
   `Promise.resolve()`/`Promise.reject()` déjà résolues — aucun test de ce
   fichier n'a jamais soumis le formulaire d'enregistrement. Les deux tests
   ci-dessous posent leur PROPRE feinte pour l'écriture, avec une promesse que
   le test résout lui-même : seul moyen d'observer ce qui vit PENDANT
   l'aller-retour, plutôt qu'un résultat déjà retombé.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Équipements — l’état d’enregistrement, observé PENDANT que la requête est en vol', () => {
  it('« Enregistrer » devient inerte et l’indicateur dit « Enregistrement… », puis les deux redeviennent normaux', async () => {
    const base = toutServi([equipement({ id: 'eq-1' })]);
    let repondre: ((valeur: unknown) => void) | undefined;
    appel.mockImplementation((chemin: string, options?: RequestInit) => {
      const methode = options?.method ?? 'GET';
      if (methode === 'GET') {
        if (chemin === '/equipements') return Promise.resolve(base.equipements);
        if (chemin === '/equipements/diagnostic-puissance') return Promise.resolve(base.diagnostic);
        if (chemin === '/equipements/point-equilibre-autoproduction')
          return Promise.resolve(base.pointEquilibre);
        if (chemin === '/equipements/empreinte-quantites-physiques')
          return Promise.resolve(base.empreinte);
      }
      if (methode === 'PATCH' && chemin === '/equipements/eq-1') {
        return new Promise((resoudre) => {
          repondre = resoudre;
        });
      }
      return Promise.reject(new Error(`Appel non attendu dans ce test : ${methode} ${chemin}`));
    });
    render(<Equipements />);

    await screen.findByText('Radiateur soufflant');
    await userEvent.click(screen.getByText('Radiateur soufflant'));
    const bouton = screen.getByRole('button', { name: 'Enregistrer' });
    await userEvent.click(bouton);

    // La requête est EN VOL ici, et seulement ici.
    expect(bouton).toBeDisabled();
    expect(screen.getByText('Enregistrement…')).toBeInTheDocument();

    repondre?.(equipement({ id: 'eq-1' }));

    await vi.waitFor(() => expect(bouton).not.toBeDisabled());
    expect(await screen.findByText(/^Enregistré /)).toBeInTheDocument();
  });

  /**
   * ═══ DÉFAUT RÉEL, NON CORRIGÉ (hors zone d'écriture de cette mission) ═══
   *
   * Même défaut que sur `Produits.tsx`, `Menus.tsx`, `LieuxMarche.tsx` et
   * `NomenclatureVente.tsx` : `enregistrer()` (`Equipements.tsx`) ne consulte
   * jamais `enregistrement.phase` avant de reposter. Le bouton « Enregistrer »
   * est bien `disabled={enregistrement.phase === 'enregistrement'}`, ce qui
   * bloque un second CLIC — mais Ctrl+S est lu par le `onKeyDown` du `<div>`
   * racine et appelle `enregistrer()` sans jamais regarder cet état. Un second
   * Ctrl+S pendant l'envoi CONTOURNE donc le bouton désactivé et repart en
   * DEUXIÈME requête PATCH pour un seul geste d'enregistrement.
   *
   * Ce test échoue intentionnellement : il décrit le comportement SAIN (une
   * seule requête), que le code actuel ne tient pas.
   */
  it.fails(
    'DÉFAUT RÉEL : un second Ctrl+S pendant l’envoi contourne le bouton `disabled` et repart en réseau',
    async () => {
      const base = toutServi([equipement({ id: 'eq-1' })]);
      const resolveurs: Array<(valeur: unknown) => void> = [];
      appel.mockImplementation((chemin: string, options?: RequestInit) => {
        const methode = options?.method ?? 'GET';
        if (methode === 'GET') {
          if (chemin === '/equipements') return Promise.resolve(base.equipements);
          if (chemin === '/equipements/diagnostic-puissance')
            return Promise.resolve(base.diagnostic);
          if (chemin === '/equipements/point-equilibre-autoproduction')
            return Promise.resolve(base.pointEquilibre);
          if (chemin === '/equipements/empreinte-quantites-physiques')
            return Promise.resolve(base.empreinte);
        }
        if (methode === 'PATCH' && chemin === '/equipements/eq-1') {
          return new Promise((resoudre) => resolveurs.push(resoudre));
        }
        return Promise.reject(new Error(`Appel non attendu dans ce test : ${methode} ${chemin}`));
      });
      render(<Equipements />);

      await screen.findByText('Radiateur soufflant');
      await userEvent.click(screen.getByText('Radiateur soufflant'));

      // Un champ SANS conséquence sur la validité du corps envoyé : la seule
      // chose qui compte ici est que le focus reste DANS le formulaire.
      const notes = document.querySelector('[name="notes"]') as HTMLInputElement;
      notes.focus();

      await userEvent.keyboard('{Control>}s{/Control}');
      expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();

      // Le bouton est déjà `disabled` — et pourtant rien n'empêche ce second
      // Ctrl+S d'appeler `enregistrer()` une deuxième fois.
      await userEvent.keyboard('{Control>}s{/Control}');

      // Toujours résoudre AVANT l'assertion qui échoue, sinon les promesses
      // fuient dans le test suivant.
      resolveurs.forEach((r) => r(equipement({ id: 'eq-1' })));

      expect(resolveurs.length).toBe(1);
    },
  );
});
