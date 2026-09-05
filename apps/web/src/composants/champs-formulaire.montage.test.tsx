/**
 * `champs-formulaire` MONTÉ — la preuve qui vaut désormais pour TOUS les écrans.
 *
 * ═══ Pourquoi ce fichier compte plus qu'un test d'écran ═══
 *
 * Le 01/08/2026, le correctif « `required` → `aria-required` » a dû être
 * appliqué SEPT fois, parce que `ChampTexte` existait en six exemplaires
 * divergents plus une septième variante. Mesuré ce jour-là par mutation :
 * remettre `required` dans `Produits.tsx` ou `Fournisseurs.tsx` laissait leurs
 * suites **entièrement vertes** — aucun test ne voyait la régression.
 *
 * Ces composants étant maintenant partagés, la preuve vit ICI, une seule fois,
 * et couvre tous leurs appelants. C'est le vrai gain de la consolidation :
 * pas moins de lignes, mais **un seul endroit où le défaut peut revenir, et un
 * test qui le voit**.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  ChampSelect,
  ChampTexte,
  IndicateurEnregistrement,
  type EtatEnregistrement,
} from './champs-formulaire';

const OPTIONS = [
  { valeur: 'moulin', libelle: 'Moulin' },
  { valeur: 'ferme', libelle: 'Ferme' },
] as const;

/* ═══════════════════════════════════════════════════════════════════════════
   LE défaut à ne jamais laisser revenir
   ═══════════════════════════════════════════════════════════════════════════ */

describe('champs-formulaire — la validation NATIVE ne doit jamais reprendre la main', () => {
  it(
    'un champ obligatoire VIDE laisse le formulaire se soumettre : c’est la validation ' +
      'applicative qui refuse, pas le navigateur',
    async () => {
      const utilisateur = userEvent.setup();
      const soumettre = vi.fn((evenement: React.FormEvent) => evenement.preventDefault());

      const { container } = render(
        <form onSubmit={soumettre}>
          <ChampTexte nom="nom" libelle="Nom" valeur="" onChange={() => {}} obligatoire />
          <button type="submit">Enregistrer</button>
        </form>,
      );

      const champ = container.querySelector<HTMLInputElement>('input[name="nom"]');
      let invalides = 0;
      champ?.addEventListener('invalid', () => {
        invalides += 1;
      });

      await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

      /*
        LES TROIS ASSERTIONS SONT NÉCESSAIRES ENSEMBLE. `valueMissing` à faux
        dit que le navigateur ne considère plus le champ comme fautif ; zéro
        évènement `invalid` dit qu'il n'a pas tenté de bloquer ; et le `submit`
        reçu dit que l'écran a bien eu sa chance de refuser lui-même. Avec
        `required`, on mesurait exactement l'inverse : `valueMissing === true`,
        deux `invalid`, ZÉRO `submit`.
      */
      expect(champ?.validity.valueMissing).toBe(false);
      expect(invalides).toBe(0);
      expect(soumettre).toHaveBeenCalledTimes(1);
    },
  );

  it('la même garantie sur une liste déroulante obligatoire', async () => {
    const utilisateur = userEvent.setup();
    const soumettre = vi.fn((evenement: React.FormEvent) => evenement.preventDefault());

    const { container } = render(
      <form onSubmit={soumettre}>
        <ChampSelect
          nom="type"
          libelle="Type"
          valeur=""
          onChange={() => {}}
          options={OPTIONS}
          optionVide="Choisir…"
          obligatoire
        />
        <button type="submit">Enregistrer</button>
      </form>,
    );

    const champ = container.querySelector<HTMLSelectElement>('select[name="type"]');
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(champ?.validity.valueMissing).toBe(false);
    expect(soumettre).toHaveBeenCalledTimes(1);
  });

  it('l’obligation reste ANNONCÉE : `aria-required`, jamais la perte d’information', () => {
    render(<ChampTexte nom="nom" libelle="Nom" valeur="" onChange={() => {}} obligatoire />);

    const champ = screen.getByRole('textbox', { name: 'Nom' });
    expect(champ).toHaveAttribute('aria-required', 'true');
    // Discriminant : c'est l'attribut NATIF qui doit avoir disparu.
    expect(champ).not.toHaveAttribute('required');
  });

  it('un champ facultatif n’annonce pas d’obligation', () => {
    render(<ChampTexte nom="notes" libelle="Notes" valeur="" onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveAttribute(
      'aria-required',
      'false',
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Ce que la fusion des six variantes devait préserver
   ═══════════════════════════════════════════════════════════════════════════ */

describe('champs-formulaire — entier et décimal ne sont pas le même clavier', () => {
  it('« entier » demande le pavé NUMÉRIQUE — quantités en grammes, comptes (règle 4)', () => {
    render(
      <ChampTexte nom="qte" libelle="Quantité" valeur="" onChange={() => {}} numerique="entier" />,
    );
    expect(screen.getByRole('textbox', { name: 'Quantité' })).toHaveAttribute(
      'inputmode',
      'numeric',
    );
  });

  it('« decimal » expose le séparateur décimal — montants en euros, densités', () => {
    render(
      <ChampTexte nom="prix" libelle="Prix" valeur="" onChange={() => {}} numerique="decimal" />,
    );
    expect(screen.getByRole('textbox', { name: 'Prix' })).toHaveAttribute('inputmode', 'decimal');
  });

  it(
    'sans `numerique`, AUCUN `inputMode` n’est imposé — un nom de fournisseur n’a rien à faire ' +
      'd’un pavé numérique',
    () => {
      render(<ChampTexte nom="nom" libelle="Nom" valeur="" onChange={() => {}} />);
      expect(screen.getByRole('textbox', { name: 'Nom' })).not.toHaveAttribute('inputmode');
    },
  );

  it('`lectureSeule` rend le champ non modifiable — besoin propre à `Recettes`', async () => {
    const utilisateur = userEvent.setup();
    const changer = vi.fn();
    render(<ChampTexte nom="code" libelle="Code" valeur="R1" onChange={changer} lectureSeule />);

    const champ = screen.getByRole('textbox', { name: 'Code' });
    expect(champ).toHaveAttribute('readonly');
    await utilisateur.type(champ, 'X');
    expect(changer).not.toHaveBeenCalled();
  });

  it('un champ sans `lectureSeule` reste modifiable — discriminant du test ci-dessus', async () => {
    const utilisateur = userEvent.setup();
    const changer = vi.fn();
    render(<ChampTexte nom="code" libelle="Code" valeur="" onChange={changer} />);

    await utilisateur.type(screen.getByRole('textbox', { name: 'Code' }), 'X');
    expect(changer).toHaveBeenCalledWith('X');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Nom accessible, aide et erreur
   ═══════════════════════════════════════════════════════════════════════════ */

describe('champs-formulaire — l’aide décrit le champ, elle ne le NOMME pas', () => {
  it('le nom accessible reste le seul libellé, même avec une aide et une erreur', () => {
    render(
      <ChampTexte
        nom="densite"
        libelle="Densité (g/ml)"
        valeur=""
        onChange={() => {}}
        aide="Sert à convertir une masse en volume."
        erreur="Densité illisible."
      />,
    );

    /*
      AVANT le correctif du 01/08/2026, l'aide et l'erreur vivaient DANS le
      `<label>` : le nom valait « Densité (g/ml)Sert à convertir…Densité
      illisible. » et le lecteur d'écran annonçait tout deux fois — une fois
      comme nom, une fois via `aria-describedby`.
    */
    const champ = screen.getByRole('textbox', { name: 'Densité (g/ml)' });
    expect(champ).toBeInTheDocument();
    // …et les deux textes restent bien RELIÉS, en description.
    const decrit = champ.getAttribute('aria-describedby') ?? '';
    expect(decrit).toContain('densite-aide');
    expect(decrit).toContain('densite-erreur');
  });

  it('un champ en erreur est annoncé invalide, et son message est lisible', () => {
    render(
      <ChampTexte
        nom="prix"
        libelle="Prix"
        valeur="offert"
        onChange={() => {}}
        erreur="Montant illisible. Exemple attendu : 24,90"
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Prix' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Montant illisible. Exemple attendu : 24,90')).toBeInTheDocument();
  });

  it('sans erreur, le champ n’est PAS annoncé invalide — discriminant', () => {
    render(<ChampTexte nom="prix" libelle="Prix" valeur="24,90" onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Prix' })).toHaveAttribute('aria-invalid', 'false');
  });

  it(
    '`libelleMasque` retire le libellé de l’ÉCRAN sans le retirer aux lecteurs d’écran — ' +
      'usage en rangée de tableau',
    () => {
      render(
        <ChampTexte
          nom="qte"
          libelle="Quantité reçue, ligne 1"
          valeur=""
          onChange={() => {}}
          libelleMasque
        />,
      );

      // Nommé pour l'assistance…
      expect(screen.getByRole('textbox', { name: 'Quantité reçue, ligne 1' })).toBeInTheDocument();
      // …mais aucun texte visible ne le répète.
      expect(screen.queryByText('Quantité reçue, ligne 1')).not.toBeInTheDocument();
    },
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   Liste déroulante
   ═══════════════════════════════════════════════════════════════════════════ */

describe('champs-formulaire — la liste déroulante', () => {
  it('rend ses options, et l’option vide seulement quand elle est demandée', () => {
    const { rerender } = render(
      <ChampSelect
        nom="type"
        libelle="Type"
        valeur=""
        onChange={() => {}}
        options={OPTIONS}
        optionVide="Choisir…"
      />,
    );
    expect(
      [...(screen.getByRole('combobox', { name: 'Type' }) as HTMLSelectElement).options].map(
        (o) => o.textContent,
      ),
    ).toEqual(['Choisir…', 'Moulin', 'Ferme']);

    rerender(
      <ChampSelect
        nom="type"
        libelle="Type"
        valeur="moulin"
        onChange={() => {}}
        options={OPTIONS}
      />,
    );
    expect(
      [...(screen.getByRole('combobox', { name: 'Type' }) as HTMLSelectElement).options].map(
        (o) => o.textContent,
      ),
    ).toEqual(['Moulin', 'Ferme']);
  });

  it('remonte la valeur choisie, jamais l’évènement brut', async () => {
    const utilisateur = userEvent.setup();
    const changer = vi.fn();
    render(
      <ChampSelect
        nom="type"
        libelle="Type"
        valeur=""
        onChange={changer}
        options={OPTIONS}
        optionVide="Choisir…"
      />,
    );

    await utilisateur.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'ferme');
    expect(changer).toHaveBeenCalledWith('ferme');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Indicateur de sauvegarde — six copies réduites à une
   ═══════════════════════════════════════════════════════════════════════════ */

describe('IndicateurEnregistrement — les quatre phases, et le tiret qui n’est pas un zéro', () => {
  const cas: ReadonlyArray<readonly [EtatEnregistrement, string]> = [
    [{ phase: 'inchange' }, '—'],
    [{ phase: 'modifie' }, 'Modifications non enregistrées'],
    [{ phase: 'enregistrement' }, 'Enregistrement…'],
    [{ phase: 'enregistre', heure: '14:32' }, 'Enregistré 14:32'],
  ];

  it.each(cas)('rend « %s » correctement', (etat, attendu) => {
    render(<IndicateurEnregistrement etat={etat} />);
    expect(screen.getByText(attendu)).toBeInTheDocument();
  });

  it(
    'l’état « inchangé » affiche un TIRET, jamais « Enregistré » — un écran jamais touché ne ' +
      'doit pas affirmer une sauvegarde',
    () => {
      render(<IndicateurEnregistrement etat={{ phase: 'inchange' }} />);
      expect(screen.queryByText(/Enregistré/)).not.toBeInTheDocument();
    },
  );
});
