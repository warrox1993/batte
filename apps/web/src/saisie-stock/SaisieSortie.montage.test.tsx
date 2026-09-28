/**
 * `SaisieSortie` MONTÉ — l'écriture de stock la plus dangereuse du produit.
 *
 * ═══ Pourquoi ce fichier existe ═══
 *
 * `SaisieSortie.tsx` n'avait AUCUN test le 01/08/2026 : 10,69 % de couverture,
 * 0 % de ses fonctions. C'est pourtant le seul écran où le porteur retire de la
 * matière à la main — donc le seul où une saisie acceptée à tort fabrique un
 * écart de stock que plus rien ne rattrape (CLAUDE.md §3 règle 5 : le stock est
 * la SOMME des mouvements, il n'y a pas de correction par `UPDATE`).
 *
 * Rien de tout ce qui est vérifié ici n'était atteignable par
 * `renderToStaticMarkup` : les cinq refus de saisie, le nettoyage d'erreur à la
 * frappe, la remise à zéro du motif au changement de nature, la répartition
 * d'un 422 entre bandeau et message de champ, Ctrl+S — tous ne vivent qu'après
 * le premier rendu.
 *
 * Ce que ce fichier ne prouve PAS : que le serveur refuse les mêmes choses.
 * Il prouve que l'écran ne lui donne jamais l'occasion, ce qui est une autre
 * question (voir `packages/db/src/services/mouvements.ts` pour l'autre moitié).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formaterQuantite } from '@batte/core';

// Le module réseau est remplacé AVANT l'import du composant, mais `ErreurApi`
// doit rester la VRAIE classe : `repartirErreurApi` (`./champs`) fait un
// `instanceof` dessus, et une classe factice ferait tomber TOUT refus serveur
// dans la branche « Erreur inattendue, sans plus de détail. » — le test serait
// vert pour la mauvaise raison.
import type * as ModuleApi from '../lib/api';

vi.mock('../lib/api', async (importerReel) => {
  // `import type * as …` et non `typeof import(...)` : la règle ESLint
  // `consistent-type-imports` interdit la seconde forme — même formulation que
  // `BoutonDocument.montage.test.tsx`, le modèle de ce dépôt.
  const reel = await importerReel<typeof ModuleApi>();
  return { ...reel, requeteApi: vi.fn() };
});

const { ErreurApi, requeteApi } = await import('../lib/api');
const { SaisieSortie } = await import('./SaisieSortie');

const appelApi = vi.mocked(requeteApi);

/** Réponse conforme à `schemaSortieCreee` : deux mouvements FEFO, 4,12 €. */
const SORTIE_CREEE = { nbMouvements: 2, coutTotalCents: 412 };

type Props = Parameters<typeof SaisieSortie>[0];

function proprietes(surcharges: Partial<Props> = {}): Props {
  return {
    ingredientId: 'ingredient-farine',
    nomIngredient: 'Farine de froment T55',
    unite: 'g',
    // 21 kg : le chiffre de l'exemple de `repartirErreurApi`, pour que la
    // fixture reste cohérente avec le message serveur rejoué plus bas.
    quantiteDisponible: 21_000,
    onEnregistre: vi.fn(),
    onAnnuler: vi.fn(),
    ...surcharges,
  };
}

function poser(surcharges: Partial<Props> = {}): Props {
  const props = proprietes(surcharges);
  render(<SaisieSortie {...props} />);
  return props;
}

/**
 * Accès aux champs par leur NOM ACCESSIBLE, jamais par un sélecteur CSS : c'est
 * ce que la règle n°10 (CLAUDE.md §3) rend vérifiable — un champ introuvable
 * par son libellé est un champ qu'un utilisateur au clavier ne peut pas nommer.
 *
 * Les motifs sont ancrés (`^`) plutôt qu'exacts parce que `Enveloppe`
 * (`./champs`) place le texte d'aide À L'INTÉRIEUR du `<label>` : il entre donc
 * dans le nom accessible du contrôle. Voir le test (ex-`it.fails`) en fin de fichier —
 * c'est un défaut, pas une convenance de test.
 */
const champNature = () => screen.getByRole('combobox', { name: /^Nature de la sortie/ });
const champMotif = () => screen.getByRole('combobox', { name: /^Motif/ });
const champQuantite = () => screen.getByRole('textbox', { name: /^Quantité sortie/ });
const champPrecision = () => screen.getByRole('textbox', { name: 'Précision (facultatif)' });
/** `input[type=date]` n'a pas de rôle ARIA mappé : son libellé reste la seule prise. */
const champDate = () => screen.getByLabelText('Date');

/** Les trois champs qui rendent une saisie valide, dans l'ordre du formulaire. */
async function remplirSaisieValide(utilisateur: ReturnType<typeof userEvent.setup>): Promise<void> {
  await utilisateur.selectOptions(champMotif(), 'CASSE_TRANSPORT');
  await utilisateur.type(champQuantite(), '500');
}

beforeEach(() => {
  appelApi.mockReset();
});

/* ═══════════════════════════════════════════════════════════════════════════
   Les refus de saisie, un par un, avec leur message exact
   ═══════════════════════════════════════════════════════════════════════════ */

describe('SaisieSortie — refus de saisie : aucun appel réseau ne part sur un formulaire incomplet', () => {
  it('un motif non choisi bloque : rien ne part sur le réseau', async () => {
    const utilisateur = userEvent.setup();
    poser();

    await utilisateur.type(champQuantite(), '500');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer la sortie' }));

    // LE point : un mouvement sans code motif ne répond pas à « où fuit la
    // matière ? » (docs/07 §6.8 rang 9). Il ne doit jamais atteindre le réseau.
    // Ce garde-fou-là tient — voir le test (ex-`it.fails`) juste en dessous pour ce qui,
    // lui, ne tient pas : le MESSAGE que l'écran croit afficher.
    expect(appelApi).not.toHaveBeenCalled();
  });

  it('le refus de motif est bien atteignable — mais par Ctrl+S, pas par le bouton', async () => {
    const utilisateur = userEvent.setup();
    poser();

    await utilisateur.type(champQuantite(), '500');
    // Ctrl+S appelle `enregistrer()` DIRECTEMENT (`onKeyDown` du `<form>`) : il
    // court-circuite la soumission, donc la validation native (voir `it.fails`).
    await utilisateur.keyboard('{Control>}s{/Control}');

    expect(screen.getByText('Choisissez un motif dans la liste.')).toBeInTheDocument();
    expect(appelApi).not.toHaveBeenCalled();
  });

  /**
   * ═══ DÉFAUT RÉEL n°1, CORRIGÉ (voir `./champs.tsx`) ═══
   *
   * `ChampSelection nom="motifCode"` recevait `obligatoire`, ce qui posait
   * `required` sur le `<select>`. Le bouton « Enregistrer la sortie » est un
   * `type="submit"` : le navigateur exécutait donc sa VALIDATION NATIVE AVANT
   * de soumettre, et comme le motif était vide, la soumission était ANNULÉE —
   * `enregistrer()` n'était jamais appelée, et aucun des trois refus qu'elle
   * sait formuler ne s'affichait par ce chemin, qui est pourtant le chemin
   * principal (un clic à la souris, sans Ctrl+S).
   *
   * CORRECTIF : `ChampSaisie`/`ChampSelection` (`./champs.tsx`) posent
   * désormais `aria-required` plutôt que `required`. L'information reste
   * disponible aux lecteurs d'écran, mais le navigateur ne bloque plus la
   * soumission — c'est la validation applicative de `enregistrer()`, déjà
   * écrite pour signaler tous les champs fautifs à la fois, qui prend le
   * relais. Voir le test « mesure du mécanisme » ci-dessous pour la preuve
   * que le `<select>` ne porte plus `required` et que le clic émet bien un
   * `submit`.
   */
  it('le message de refus du motif s’affiche désormais au CLIC, pas seulement au Ctrl+S', async () => {
    const utilisateur = userEvent.setup();
    poser();

    await utilisateur.type(champQuantite(), '500');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer la sortie' }));

    expect(screen.getByText('Choisissez un motif dans la liste.')).toBeInTheDocument();
  });

  it(
    'au clic, TOUS les refus s’affichent à la fois — motif, quantité et date — la validation ' +
      'native ne masque plus les deux autres derrière celle du motif',
    async () => {
      const utilisateur = userEvent.setup();
      poser();

      await utilisateur.clear(champDate());
      await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer la sortie' }));

      expect(screen.getByText('Choisissez un motif dans la liste.')).toBeInTheDocument();
      expect(screen.getByText(/nombre entier de grammes/)).toBeInTheDocument();
      expect(screen.getByText('Indiquez le jour où la matière est sortie.')).toBeInTheDocument();
      expect(appelApi).not.toHaveBeenCalled();
    },
  );

  it(
    'mesure du mécanisme (après correctif) : le `<select>` ne porte plus `required`, le clic ' +
      'émet un `submit` et AUCUN `invalid`',
    async () => {
      const utilisateur = userEvent.setup();
      const { container } = render(<SaisieSortie {...proprietes()} />);
      const formulaire = container.querySelector('form');
      const motif = container.querySelector<HTMLSelectElement>('select[name="motifCode"]');
      let invalides = 0;
      let soumissions = 0;
      motif?.addEventListener('invalid', () => {
        invalides += 1;
      });
      formulaire?.addEventListener('submit', () => {
        soumissions += 1;
      });

      await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer la sortie' }));

      // Plus de `required` : le motif vide ne rend plus le `<select>` invalide
      // aux yeux du navigateur — c'est `aria-required` qui porte l'obligation
      // pour les lecteurs d'écran, sans intercepter la soumission.
      expect(motif?.validity.valueMissing).toBe(false);
      expect(invalides).toBe(0);
      // C'est CE `submit` qui rend `enregistrer()` — et donc le message
      // français — atteignable au clic.
      expect(soumissions).toBe(1);
    },
  );

  it('une quantité vide bloque, et le message nomme l’unité de RÉFÉRENCE de l’ingrédient', async () => {
    const utilisateur = userEvent.setup();
    poser({ unite: 'ml' });

    await utilisateur.selectOptions(champMotif(), 'CASSE_TRANSPORT');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer la sortie' }));

    expect(
      screen.getByText(
        'La quantité sortie doit être un nombre entier de millilitres, supérieur à zéro.',
      ),
    ).toBeInTheDocument();
    expect(appelApi).not.toHaveBeenCalled();
  });

  it('une quantité de ZÉRO est refusée comme une quantité absente — un mouvement vide n’existe pas', async () => {
    const utilisateur = userEvent.setup();
    poser();

    await utilisateur.selectOptions(champMotif(), 'CASSE_TRANSPORT');
    await utilisateur.type(champQuantite(), '0');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer la sortie' }));

    expect(screen.getByText(/nombre entier de grammes, supérieur à zéro/)).toBeInTheDocument();
    expect(appelApi).not.toHaveBeenCalled();
  });

  it('une quantité décimale est refusée : les grammes et millilitres sont ENTIERS (CLAUDE.md §3 règle 4)', async () => {
    const utilisateur = userEvent.setup();
    poser();

    await utilisateur.selectOptions(champMotif(), 'CASSE_TRANSPORT');
    await utilisateur.type(champQuantite(), '12,5');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer la sortie' }));

    expect(screen.getByText(/nombre entier de grammes/)).toBeInTheDocument();
    expect(appelApi).not.toHaveBeenCalled();
  });

  it('une date vidée bloque, avec le message qui dit ce qu’on attend', async () => {
    const utilisateur = userEvent.setup();
    poser();

    await utilisateur.selectOptions(champMotif(), 'CASSE_TRANSPORT');
    await utilisateur.type(champQuantite(), '500');
    await utilisateur.clear(champDate());
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer la sortie' }));

    expect(screen.getByText('Indiquez le jour où la matière est sortie.')).toBeInTheDocument();
    expect(appelApi).not.toHaveBeenCalled();
  });

  it('les refus s’affichent TOUS à la fois : trois champs fautifs, trois messages', async () => {
    const utilisateur = userEvent.setup();
    poser();

    await utilisateur.clear(champDate());
    // Ctrl+S et non le clic : c'est le seul chemin qui atteint `enregistrer()`
    // quand le motif est vide (voir le test (ex-`it.fails`) ci-dessus).
    await utilisateur.keyboard('{Control>}s{/Control}');

    expect(screen.getByText('Choisissez un motif dans la liste.')).toBeInTheDocument();
    expect(screen.getByText(/nombre entier de grammes/)).toBeInTheDocument();
    expect(screen.getByText('Indiquez le jour où la matière est sortie.')).toBeInTheDocument();
  });

  it('corriger un champ efface SON message, sans toucher aux autres', async () => {
    const utilisateur = userEvent.setup();
    poser();

    // Le `onKeyDown` vit sur le `<form>` : le raccourci n'y remonte que depuis
    // un champ FOCALISÉ. Frappé sur `<body>`, Ctrl+S ne déclenche rien — ce qui
    // est en soi une limite du raccourci, mesurée par le test dédié plus bas.
    champQuantite().focus();
    await utilisateur.keyboard('{Control>}s{/Control}');
    expect(screen.getByText('Choisissez un motif dans la liste.')).toBeInTheDocument();
    expect(screen.getByText(/nombre entier de grammes/)).toBeInTheDocument();

    await utilisateur.selectOptions(champMotif(), 'CASSE_TRANSPORT');

    expect(screen.queryByText('Choisissez un motif dans la liste.')).not.toBeInTheDocument();
    // L'autre message SURVIT : sinon corriger un champ effacerait la liste des
    // autres, et l'utilisateur croirait le formulaire valide.
    expect(screen.getByText(/nombre entier de grammes/)).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Nature de la sortie ↔ motif : deux champs liés
   ═══════════════════════════════════════════════════════════════════════════ */

describe('SaisieSortie — la nature filtre les motifs, et changer de nature remet le motif à zéro', () => {
  it('« Perte » propose les motifs de perte, jamais ceux d’un écart d’inventaire', () => {
    poser();
    const motif = champMotif() as HTMLSelectElement;
    const codes = [...motif.options].map((o) => o.value);

    expect(codes).toContain('CASSE_TRANSPORT');
    expect(codes).toContain('DLC_DEPASSEE');
    // Discriminant : `INVENTAIRE_ECART` appartient à la catégorie `ajustement`.
    // Une liste qui les contiendrait tous rendrait ce test vert sans rien dire.
    expect(codes).not.toContain('INVENTAIRE_ECART');
    expect(codes).not.toContain('PERSO');
  });

  it('« Écart d’inventaire » bascule la liste sur les motifs d’ajustement', async () => {
    const utilisateur = userEvent.setup();
    poser();

    await utilisateur.selectOptions(champNature(), 'ajustement_inventaire');

    const codes = [...(champMotif() as HTMLSelectElement).options].map((o) => o.value);
    expect(codes).toContain('INVENTAIRE_ECART');
    expect(codes).toContain('ERREUR_SAISIE');
    expect(codes).not.toContain('CASSE_TRANSPORT');
  });

  it(
    'changer de nature APRÈS avoir choisi un motif le remet à « Choisir… » — sans quoi un motif ' +
      'de perte partirait sur un écart d’inventaire, et le serveur ne peut pas le voir',
    async () => {
      const utilisateur = userEvent.setup();
      poser();

      const motif = champMotif() as HTMLSelectElement;
      await utilisateur.selectOptions(motif, 'CASSE_TRANSPORT');
      expect(motif.value).toBe('CASSE_TRANSPORT');

      await utilisateur.selectOptions(champNature(), 'ajustement_inventaire');
      await utilisateur.type(champQuantite(), '500');
      await utilisateur.keyboard('{Control>}s{/Control}');

      /*
        LIRE LE `value` DU `<select>` NE SUFFIT PAS, et c'est le piège exact que
        ce dépôt appelle « fixture aveugle ». Les deux catégories de motifs sont
        DISJOINTES : un `<select>` contrôlé dont la valeur d'état n'existe plus
        dans ses options rend `''` de toute façon. Une mutation qui SUPPRIME
        `setMotifCode('')` laissait donc ce test vert — mesuré le 01/08/2026.

        Le seul témoin qui discrimine est ce qui PARTIRAIT sur le réseau : sans
        remise à zéro, `motifCode` vaudrait encore `CASSE_TRANSPORT` (un motif
        de PERTE) sur un type `ajustement_inventaire`, la validation locale le
        laisserait passer, et le serveur n'a aucun moyen de voir l'incohérence.
      */
      expect(screen.getByText('Choisissez un motif dans la liste.')).toBeInTheDocument();
      expect(appelApi).not.toHaveBeenCalled();
    },
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   L'aide sous le champ Quantité — inconnu ≠ zéro
   ═══════════════════════════════════════════════════════════════════════════ */

describe('SaisieSortie — le disponible et l’aperçu passent par le formateur, jamais par un littéral', () => {
  it('affiche le disponible dans l’unité de l’ingrédient', () => {
    poser({ quantiteDisponible: 21_000, unite: 'g' });
    // Comparé VIA le formateur : `formaterQuantite` passe par `Intl` et place
    // une espace insécable — un littéral tapé à la main ne correspondrait pas.
    expect(screen.getByText(formaterQuantite(21_000, 'g'))).toBeInTheDocument();
  });

  it('n’affiche AUCUN aperçu tant que la quantité est illisible — jamais « 0 g » par défaut', async () => {
    const utilisateur = userEvent.setup();
    poser();

    await utilisateur.type(champQuantite(), 'abc');

    // Le zéro formaté ne doit apparaître NULLE PART : un aperçu à zéro dirait
    // « je sors zéro gramme », alors que la vraie phrase est « je ne sais pas ».
    expect(screen.queryByText(formaterQuantite(0, 'g'))).not.toBeInTheDocument();
  });

  it('affiche l’aperçu formaté dès que la quantité se lit', async () => {
    const utilisateur = userEvent.setup();
    poser();

    await utilisateur.type(champQuantite(), '1500');

    expect(screen.getByText(formaterQuantite(1500, 'g'))).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Transitions d'état : soumission → succès, soumission → refus
   ═══════════════════════════════════════════════════════════════════════════ */

describe('SaisieSortie — ce qui part sur le réseau, et ce qui revient', () => {
  it('un formulaire valide poste un MOUVEMENT sur `/mouvements`, jamais une quantité', async () => {
    const utilisateur = userEvent.setup();
    appelApi.mockResolvedValue(SORTIE_CREEE);
    const props = poser();

    await remplirSaisieValide(utilisateur);
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer la sortie' }));

    await waitFor(() => expect(props.onEnregistre).toHaveBeenCalledWith(SORTIE_CREEE));

    const [chemin, options] = appelApi.mock.calls[0] ?? [];
    // CLAUDE.md §3 règle 5 : le stock ne se modifie QUE par un mouvement.
    expect(chemin).toBe('/mouvements');
    expect(options?.method).toBe('POST');
    const corps: unknown = JSON.parse(String(options?.body));
    expect(corps).toMatchObject({
      ingredientId: 'ingredient-farine',
      quantite: 500,
      type: 'perte',
      motifCode: 'CASSE_TRANSPORT',
      // Non coché : jeter un lot périmé exige un geste explicite (invariant n°2
      // de docs/02), jamais un défaut de l'application.
      autoriserDlcDepassee: false,
    });
  });

  it('une précision laissée vide part en `null`, jamais en chaîne vide', async () => {
    const utilisateur = userEvent.setup();
    appelApi.mockResolvedValue(SORTIE_CREEE);
    poser();

    await remplirSaisieValide(utilisateur);
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer la sortie' }));

    await waitFor(() => expect(appelApi).toHaveBeenCalled());
    const corps = JSON.parse(String(appelApi.mock.calls[0]?.[1]?.body)) as {
      motifTexte: unknown;
    };
    expect(corps.motifTexte).toBeNull();
  });

  it('cocher « Autoriser les lots dont la DLC est dépassée » le transmet — c’est le SEUL chemin pour jeter un lot périmé', async () => {
    const utilisateur = userEvent.setup();
    appelApi.mockResolvedValue(SORTIE_CREEE);
    poser();

    await remplirSaisieValide(utilisateur);
    await utilisateur.click(screen.getByRole('checkbox', { name: /^Autoriser les lots/ }));
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer la sortie' }));

    await waitFor(() => expect(appelApi).toHaveBeenCalled());
    const corps = JSON.parse(String(appelApi.mock.calls[0]?.[1]?.body)) as {
      autoriserDlcDepassee: unknown;
    };
    expect(corps.autoriserDlcDepassee).toBe(true);
  });

  it('le bouton annonce l’envoi en cours et redevient actionnable après la réponse', async () => {
    const utilisateur = userEvent.setup();
    let repondre: ((valeur: unknown) => void) | undefined;
    appelApi.mockImplementation(
      () =>
        new Promise((resoudre) => {
          repondre = resoudre;
        }),
    );
    poser();

    await remplirSaisieValide(utilisateur);
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer la sortie' }));

    const bouton = await screen.findByRole('button', { name: 'Enregistrement…' });
    expect(bouton).toBeDisabled();

    repondre?.(SORTIE_CREEE);
    await screen.findByRole('button', { name: 'Enregistrer la sortie' });
  });

  it('un second clic pendant l’envoi n’écrit PAS un second mouvement', async () => {
    const utilisateur = userEvent.setup();
    let repondre: ((valeur: unknown) => void) | undefined;
    appelApi.mockImplementation(
      () =>
        new Promise((resoudre) => {
          repondre = resoudre;
        }),
    );
    poser();

    await remplirSaisieValide(utilisateur);
    const bouton = screen.getByRole('button', { name: 'Enregistrer la sortie' });
    await utilisateur.click(bouton);

    /*
      Ni un second CLIC ni un `{Enter}` ne prouvent quoi que ce soit ici : le
      bouton est `disabled`, donc le clic est ignoré ET la soumission implicite
      par Entrée l'est aussi (bouton par défaut désactivé). Une mutation qui
      RETIRE le verrou `if (envoiEnCours) return;` laissait ce test vert —
      mesuré le 01/08/2026 : il ne testait que le `disabled`.

      Ctrl+S, lui, appelle `enregistrer()` DIRECTEMENT, sans passer par le
      bouton : c'est le seul geste utilisateur qui atteint réellement le verrou,
      et un double envoi écrirait DEUX mouvements de stock irréversibles.
    */
    champQuantite().focus();
    await utilisateur.keyboard('{Control>}s{/Control}');

    expect(appelApi).toHaveBeenCalledTimes(1);
    repondre?.(SORTIE_CREEE);
    await screen.findByRole('button', { name: 'Enregistrer la sortie' });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Refus du serveur : le chiffre manquant et le chiffre disponible, recollés
   ═══════════════════════════════════════════════════════════════════════════ */

describe('SaisieSortie — un 422 avec `champs` se lit SOUS le champ désigné, en une seule phrase', () => {
  it(
    'recolle le message (chiffre manquant) et `champs.quantite` (chiffre disponible) — les afficher ' +
      'à deux endroits serait le double signalement que docs/07 §4.7 interdit',
    async () => {
      const utilisateur = userEvent.setup();
      appelApi.mockRejectedValue(
        new ErreurApi('Stock insuffisant en Farine T55 : il manque 78,0 kg.', {
          code: 'stock_insuffisant',
          statut: 422,
          champs: { quantite: 'Disponible : 21,0 kg.' },
        }),
      );
      poser();

      await remplirSaisieValide(utilisateur);
      await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer la sortie' }));

      const message = await screen.findByText(
        'Stock insuffisant en Farine T55 : il manque 78,0 kg. Disponible : 21,0 kg.',
      );
      // Le message vit dans le `<span id="quantite-erreur">` de `ChampSaisie`,
      // donc SOUS le champ : c'est ce que `aria-describedby` doit désigner.
      expect(message).toHaveAttribute('id', 'quantite-erreur');
      expect(champQuantite()).toHaveAttribute(
        'aria-describedby',
        expect.stringContaining('quantite-erreur'),
      );
    },
  );

  it('un champ que cet écran ne sait PAS afficher remonte en bandeau — jamais perdu en silence', async () => {
    const utilisateur = userEvent.setup();
    appelApi.mockRejectedValue(
      new ErreurApi('Le lot désigné est bloqué.', {
        code: 'lot_bloque',
        statut: 422,
        // `lotId` n'est pas dans `CHAMPS_AFFICHES` : sans absorption, ce message
        // n'aurait aucun point de rendu et l'écran resterait muet après un refus.
        champs: { lotId: 'Ce lot est en quarantaine.' },
      }),
    );
    poser();

    await remplirSaisieValide(utilisateur);
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer la sortie' }));

    const bandeau = await screen.findByRole('alert');
    expect(bandeau).toHaveTextContent('Le lot désigné est bloqué. Ce lot est en quarantaine.');
  });

  it('une erreur sans `champs` s’affiche en bandeau, et la saisie N’EST PAS vidée', async () => {
    const utilisateur = userEvent.setup();
    appelApi.mockRejectedValue(
      new ErreurApi('Période comptable verrouillée.', { code: 'periode_verrouillee', statut: 409 }),
    );
    poser();

    await remplirSaisieValide(utilisateur);
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer la sortie' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Période comptable verrouillée.');
    // Refaire taper ce qui vient d'être tapé est la faute d'ergonomie la plus
    // coûteuse d'un formulaire (commentaire de `ChampSaisie`).
    expect(champQuantite()).toHaveValue('500');
    expect((champMotif() as HTMLSelectElement).value).toBe('CASSE_TRANSPORT');
  });

  it('une coupure réseau — pas une `ErreurApi` — donne le message générique, jamais un écran muet', async () => {
    const utilisateur = userEvent.setup();
    appelApi.mockRejectedValue(new TypeError('Failed to fetch'));
    poser();

    await remplirSaisieValide(utilisateur);
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer la sortie' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Erreur inattendue, sans plus de détail.',
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Clavier — CLAUDE.md §3 règle 10
   ═══════════════════════════════════════════════════════════════════════════ */

describe('SaisieSortie — clavier (CLAUDE.md §3 règle 10)', () => {
  it('Ctrl+S enregistre depuis n’importe quel champ du formulaire', async () => {
    const utilisateur = userEvent.setup();
    appelApi.mockResolvedValue(SORTIE_CREEE);
    const props = poser();

    await remplirSaisieValide(utilisateur);
    champPrecision().focus();
    await utilisateur.keyboard('{Control>}s{/Control}');

    await waitFor(() => expect(props.onEnregistre).toHaveBeenCalledWith(SORTIE_CREEE));
  });

  it('Ctrl+S sur un formulaire incomplet refuse comme le clic, sans partir en réseau', async () => {
    const utilisateur = userEvent.setup();
    poser();

    champQuantite().focus();
    await utilisateur.keyboard('{Control>}s{/Control}');

    expect(screen.getByText('Choisissez un motif dans la liste.')).toBeInTheDocument();
    expect(appelApi).not.toHaveBeenCalled();
  });

  it(
    'Ctrl+S est porté par le `<form>`, pas par `window` : frappé hors du formulaire il ne fait ' +
      'rien — limite mesurée, pas supposée (Sessions.tsx, lui, écoute `window`)',
    async () => {
      const utilisateur = userEvent.setup();
      poser();

      document.body.focus();
      await utilisateur.keyboard('{Control>}s{/Control}');

      expect(screen.queryByText('Choisissez un motif dans la liste.')).not.toBeInTheDocument();
    },
  );

  it('« Annuler » est un bouton atteignable au clavier, et n’émet aucune écriture', async () => {
    const utilisateur = userEvent.setup();
    const props = poser();

    const annuler = screen.getByRole('button', { name: 'Annuler' });
    annuler.focus();
    expect(annuler).toHaveFocus();
    await utilisateur.keyboard('{Enter}');

    expect(props.onAnnuler).toHaveBeenCalledTimes(1);
    expect(appelApi).not.toHaveBeenCalled();
  });

  it(
    'après un refus de saisie, le bouton d’enregistrement GARDE le focus — il n’est jamais ' +
      '`disabled` sur ce chemin, donc le focus ne retombe pas sur `<body>`',
    async () => {
      const utilisateur = userEvent.setup();
      poser();

      // Motif renseigné (sinon la validation native intercepte, cf. `it.fails`),
      // quantité laissée vide : le refus vient bien de `enregistrer()`.
      await utilisateur.selectOptions(champMotif(), 'CASSE_TRANSPORT');
      const bouton = screen.getByRole('button', { name: 'Enregistrer la sortie' });
      await utilisateur.click(bouton);

      expect(screen.getByText(/nombre entier de grammes/)).toBeInTheDocument();
      expect(bouton).toHaveFocus();
      expect(document.body).not.toHaveFocus();
    },
  );

  it('chaque champ de saisie porte un libellé accessible — aucun n’est atteignable « à l’aveugle »', () => {
    poser();
    for (const champ of [champNature, champMotif, champDate, champPrecision, champQuantite]) {
      expect(champ()).toBeInTheDocument();
    }
  });

  /**
   * ═══ DÉFAUT RÉEL, CORRIGÉ (voir `Enveloppe`, `./champs.tsx`) ═══
   *
   * `Enveloppe` rendait le texte d'aide À L'INTÉRIEUR du `<label>`, et posait
   * EN MÊME TEMPS `aria-describedby` sur ce même nœud. Un lecteur d'écran
   * énonçait donc l'aide DEUX FOIS : une fois comme partie du nom du champ,
   * une fois comme description. Le nom accessible du champ « Motif » valait
   * « MotifLe motif est obligatoire : c'est lui qui répond plus tard à « où
   * fuit la matière ? ». » au lieu de « Motif ».
   *
   * C'était le double signalement que docs/07 §4.7 refuse, transposé à
   * l'annonce vocale. CORRECTIF : `Enveloppe` n'enveloppe plus, dans son
   * `<label>`, que le libellé visuel et le contrôle — l'aide et l'erreur en
   * sont sorties, reliées au seul `aria-describedby`.
   *
   * Le même patron existe dans `Ingredients.tsx` (`ChampTexte`, `ChampSelect`,
   * hors périmètre de cette mission) : un seul correctif dans `Enveloppe` n'en
   * règle donc que la moitié.
   */
  it('le nom accessible d’un champ ne contient plus son texte d’aide', () => {
    poser();
    expect(screen.getByRole('combobox', { name: 'Motif' })).toBeInTheDocument();
  });
});
