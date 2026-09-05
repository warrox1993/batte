/**
 * Tests du gabarit du registre AFSCA mensuel — fonction PURE (donnees -> HTML),
 * exercés ici SANS passer par `apps/api/src/documents/donnees.ts` (hors zone
 * d'écriture de cet audit) : chaque test construit directement l'objet
 * `DonneesRegistreAfsca` attendu par `registreAfscaMensuel`.
 *
 * Audit AFSCA du 30/07/2026 — CLAUDE.md §7 : « le registre enregistre ce qui a
 * été saisi, avec sa date de saisie réelle. [...] Si la date de l'événement et
 * la date de saisie diffèrent, les deux doivent apparaître. »
 *
 * DÉFAUT CORRIGÉ : le gabarit n'affichait QUE la date métier (`dateReleve` /
 * `dateExecution`) d'un relevé de température ou d'une exécution de nettoyage,
 * jamais l'instant réel d'écriture (`creeLe`) — même quand les deux jours
 * différaient. Un relevé de température daté du 1er juillet mais saisi
 * seulement le 15 août s'imprimait EXACTEMENT comme un relevé saisi le jour
 * même : rien ne distinguait, sur le document présenté à un contrôle, une
 * saisie contemporaine d'une reconstitution tardive.
 *
 * Corrigé en ajoutant `creeLe` (optionnel — voir sa doc sur
 * `DonneesRegistreAfscaTemperature`/`Nettoyage`) et une mention « Saisi le
 * JJ/MM/AAAA », affichée UNIQUEMENT quand le jour civil de l'écriture réelle
 * diffère du jour civil métier — jamais sur une saisie normale, le jour même.
 *
 * `apps/api/src/documents/donnees.ts` (`donneesRegistreAfsca`) transmet
 * désormais `creeLe` pour les deux sections — ce fichier prouve que le
 * gabarit sait afficher la mention ; la preuve que `donnees.ts` la lui fournit
 * RÉELLEMENT (chaîne dépôt → assemblage → gabarit → PDF, pas seulement le
 * gabarit sur des données à la main) vit dans `audit-documents.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  registreAfscaMensuel,
  type DonneesRegistreAfsca,
  type DonneesRegistreAfscaLotConcerne,
  type DonneesRegistreAfscaNettoyage,
  type DonneesRegistreAfscaNonConformite,
  type DonneesRegistreAfscaTemperature,
} from './registre-afsca.js';

/**
 * Exploitant « tout vide » : le cas courant tant que le porteur n'a rien
 * saisi dans l'écran Paramètres (`exploitant_*` — valeur par défaut `''`,
 * traduite en `null` par `Parametres.texteOuNull`). Les tests dédiés à
 * l'identité de l'exploitant ci-dessous surchargent ce champ.
 */
const EXPLOITANT_VIDE = {
  nom: null,
  adresse: null,
  numeroEntreprise: null,
  numeroEnregistrementAfsca: null,
};

/** Squelette minimal valide, pour ne faire varier que la section testée. */
function donneesMinimales(partiel: Partial<DonneesRegistreAfsca> = {}): DonneesRegistreAfsca {
  return {
    periodeLibelle: 'Juillet 2026 (test)',
    dateGeneration: new Date('2026-08-05T12:00:00.000Z'),
    exploitant: EXPLOITANT_VIDE,
    temperatures: [],
    nettoyages: [],
    nonConformites: [],
    exercicesTracabilite: [],
    ...partiel,
  };
}

/**
 * Lignes `<tr>` du corps du tableau des relevés de température.
 *
 * COMPTER les lignes rendues est le seul moyen de prouver qu'un relevé donné
 * est réellement imprimé. Une assertion `toContain` sur le document entier ne
 * le peut pas dès que deux valeurs se contiennent l'une l'autre : « 2,0 » est
 * une sous-chaîne stricte de « 12,0 », donc `toContain('2,0')` est déjà
 * satisfait par le seul relevé à 12 °C. Allonger la chaîne ne sauve rien —
 * « 2,0 °C » reste une sous-chaîne de « 12,0 °C ».
 */
function lignesTableauTemperatures(html: string): string[] {
  const apresTitre = html.split('<h2>Relevés de température</h2>')[1] ?? '';
  const corpsTableau = apresTitre.split('<tbody>')[1]?.split('</tbody>')[0] ?? '';
  return corpsTableau.split('<tr').slice(1);
}

/**
 * Température telle qu'elle est réellement imprimée dans SA cellule, ou
 * `undefined` si la ligne n'en porte aucune. Lire la cellule — et non le
 * document — est ce qui rend deux relevés distinguables.
 */
function temperatureDeLaLigne(ligne: string): string | undefined {
  return /<td class="num">([^<]*)<\/td>/.exec(ligne)?.[1];
}

/**
 * Même formateur que le gabarit, jamais un littéral tapé à la main : `Intl`
 * décide seul de ses séparateurs (docs/39 §10).
 */
function temperatureFormatee(valeur: number): string {
  return valeur.toLocaleString('fr-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

describe('Gabarit registre AFSCA — mention « Saisi le » quand la saisie diffère de la date métier', () => {
  describe('relevés de température', () => {
    const base: DonneesRegistreAfscaTemperature = {
      dateReleve: '2026-07-01',
      moment: 'depart',
      equipement: 'Glacière (test)',
      temperatureC: 3,
      conforme: true,
      actionCorrective: null,
      statut: 'active',
    };

    it('affiche la mention quand la saisie réelle tombe un autre jour que la date métier', () => {
      const { html } = registreAfscaMensuel(
        donneesMinimales({ temperatures: [{ ...base, creeLe: '2026-08-15T09:30:00.000Z' }] }),
      );

      expect(html).toContain('Saisi le 15/08/2026');
      // La date métier reste affichée EN PLUS, jamais remplacée.
      expect(html).toContain('01/07/2026');
    });

    it("n'affiche AUCUNE mention quand la saisie a lieu le jour même", () => {
      const { html } = registreAfscaMensuel(
        donneesMinimales({ temperatures: [{ ...base, creeLe: '2026-07-01T18:45:00.000Z' }] }),
      );

      expect(html).not.toContain('Saisi le');
    });

    it("n'affiche AUCUNE mention et ne plante pas quand `creeLe` est absent (donnees.ts ne le fournit pas encore)", () => {
      expect(() => registreAfscaMensuel(donneesMinimales({ temperatures: [base] }))).not.toThrow();

      const { html } = registreAfscaMensuel(donneesMinimales({ temperatures: [base] }));
      expect(html).not.toContain('Saisi le');
      expect(html).toContain('01/07/2026');
    });

    /**
     * D-083 (31/07/2026) : un relevé annulé reste au registre, barré, avec
     * son motif et sa date d'annulation — les deux relevés (le mauvais et sa
     * correction) doivent être visibles l'un ET l'autre.
     */
    describe('relevé annulé (D-083)', () => {
      const annule: DonneesRegistreAfscaTemperature = {
        ...base,
        temperatureC: 12,
        statut: 'annulee',
        motifAnnulation: 'Erreur de saisie : 12 au lieu de 2.',
        dateAnnulation: '2026-07-15T10:00:00.000Z',
      };

      it('imprime la ligne barrée (text-decoration:line-through)', () => {
        const { html } = registreAfscaMensuel(donneesMinimales({ temperatures: [annule] }));
        expect(html).toContain('style="text-decoration:line-through"');
      });

      it('affiche le motif et la date d’annulation', () => {
        const { html } = registreAfscaMensuel(donneesMinimales({ temperatures: [annule] }));
        expect(html).toContain('Relevé annulé');
        expect(html).toContain('Erreur de saisie : 12 au lieu de 2.');
        expect(html).toContain('15/07/2026');
      });

      it('un relevé actif ne porte ni le barré ni la mention d’annulation', () => {
        const { html } = registreAfscaMensuel(donneesMinimales({ temperatures: [base] }));
        expect(html).not.toContain('text-decoration:line-through');
        expect(html).not.toContain('Relevé annulé');
      });

      it('les deux relevés (mauvais annulé + bon) restent visibles ensemble, chacun sur SA ligne', () => {
        const bon: DonneesRegistreAfscaTemperature = { ...base, temperatureC: 2 };
        const { html } = registreAfscaMensuel(donneesMinimales({ temperatures: [annule, bon] }));

        // Le registre imprime bien DEUX lignes : c'est la seule façon de
        // démontrer que la CORRECTION à 2 °C est présente. Voir
        // `lignesTableauTemperatures` — « 2,0 » étant une sous-chaîne de
        // « 12,0 », aucune assertion `toContain` sur le document entier ne
        // peut distinguer « les deux relevés sont imprimés » de « seul le
        // relevé annulé l'est ». Sur un registre AFSCA, c'est la présence de
        // la correction qui est en jeu.
        const lignes = lignesTableauTemperatures(html);
        expect(lignes).toHaveLength(2);
        expect(lignes.map(temperatureDeLaLigne)).toEqual([
          temperatureFormatee(12),
          temperatureFormatee(2),
        ]);

        // Le mauvais relevé est barré, le bon ne l'est PAS : la correction se
        // lit comme la donnée en vigueur, jamais comme une écriture périmée.
        expect(lignes[0]).toContain('text-decoration:line-through');
        expect(lignes[1]).not.toContain('text-decoration:line-through');
      });

      it("ne plante pas et n'affiche aucune mention quand motif/date d'annulation sont absents", () => {
        const sansDetail: DonneesRegistreAfscaTemperature = { ...base, statut: 'annulee' };
        expect(() =>
          registreAfscaMensuel(donneesMinimales({ temperatures: [sansDetail] })),
        ).not.toThrow();

        const { html } = registreAfscaMensuel(donneesMinimales({ temperatures: [sansDetail] }));
        expect(html).toContain('style="text-decoration:line-through"');
        expect(html).toContain('Relevé annulé');
        // Ni motif ni date fabriqués : juste « Relevé annulé » nu.
        expect(html).not.toContain('Relevé annulé (');
        expect(html).not.toContain('Relevé annulé :');
      });
    });
  });

  describe('exécutions de nettoyage', () => {
    const base: DonneesRegistreAfscaNettoyage = {
      dateExecution: '2026-07-10',
      tacheLibelle: 'Nettoyage de la plaque de cuisson (test)',
      zone: 'Cuisson',
      executePar: 'Propriétaire',
      observations: null,
    };

    it('affiche la mention quand la saisie réelle tombe un autre jour que la date métier', () => {
      const { html } = registreAfscaMensuel(
        donneesMinimales({ nettoyages: [{ ...base, creeLe: '2026-07-25T21:00:00.000Z' }] }),
      );

      expect(html).toContain('Saisi le 25/07/2026');
      expect(html).toContain('10/07/2026');
    });

    it("n'affiche AUCUNE mention quand la saisie a lieu le jour même", () => {
      const { html } = registreAfscaMensuel(
        donneesMinimales({ nettoyages: [{ ...base, creeLe: '2026-07-10T20:15:00.000Z' }] }),
      );

      expect(html).not.toContain('Saisi le');
    });

    it("n'affiche AUCUNE mention quand `creeLe` est absent", () => {
      const { html } = registreAfscaMensuel(donneesMinimales({ nettoyages: [base] }));
      expect(html).not.toContain('Saisi le');
    });
  });
});

/**
 * Sections « les trous se voient » : sessions sans relevé de température et
 * tâches de nettoyage en retard. Convention `undefined` / `[]` distincte,
 * documentée sur `DonneesRegistreAfsca` — un champ absent ne doit RIEN
 * affirmer, un tableau vide affirme « vérifié, aucun trou ».
 */
describe('Gabarit registre AFSCA — sections « les trous se voient »', () => {
  describe('sessions sans relevé de température', () => {
    it('affiche chaque session signalée, avec son numéro, sa date et son lieu', () => {
      const { html } = registreAfscaMensuel(
        donneesMinimales({
          sessionsSansReleveTemperature: [
            { numero: 'S-2026-042', dateSession: '2026-07-13', lieuNom: 'La Batte' },
          ],
        }),
      );

      expect(html).toContain('S-2026-042');
      expect(html).toContain('13/07/2026');
      expect(html).toContain('La Batte');
    });

    it("affiche « aucune session sans relevé » quand la vérification a eu lieu et n'a rien trouvé", () => {
      const { html } = registreAfscaMensuel(
        donneesMinimales({ sessionsSansReleveTemperature: [] }),
      );
      expect(html).toContain('Aucune session clôturée sans relevé sur la période.');
    });

    it("n'affiche AUCUNE section quand la vérification n'a pas été faite (champ absent)", () => {
      const { html } = registreAfscaMensuel(donneesMinimales());
      expect(html).not.toContain('Sessions sans relevé de température');
    });
  });

  describe('tâches de nettoyage en retard', () => {
    it('affiche chaque tâche en retard, avec son motif', () => {
      const { html } = registreAfscaMensuel(
        donneesMinimales({
          tachesNettoyageEnRetard: [
            {
              libelle: 'Nettoyage de la plaque de cuisson (test)',
              zone: 'Cuisson',
              derniereExecution: null,
              motif: 'Jamais exécutée.',
            },
          ],
        }),
      );

      expect(html).toContain('Nettoyage de la plaque de cuisson (test)');
      expect(html).toContain('Jamais exécutée.');
    });

    it("affiche « aucune tâche en retard » quand la vérification a eu lieu et n'a rien trouvé", () => {
      const { html } = registreAfscaMensuel(donneesMinimales({ tachesNettoyageEnRetard: [] }));
      expect(html).toContain("Aucune tâche en retard à la date d'édition du registre.");
    });

    it("n'affiche AUCUNE section quand la vérification n'a pas été faite (champ absent)", () => {
      const { html } = registreAfscaMensuel(donneesMinimales());
      expect(html).not.toContain('Tâches de nettoyage en retard');
    });
  });
});

/**
 * Audit du 30/07/2026 (`packages/db/src/audit-colonnes-orphelines.test.ts`) :
 * `lot.motif_statut_id` / `lot.date_changement_statut` sont écrites à CHAQUE
 * changement de statut d'un lot (`changerStatutLot`,
 * `packages/db/src/services/mouvements.ts`) — la trace exacte qu'un contrôle
 * AFSCA vient chercher sur un lot rattaché à une non-conformité : pourquoi ce
 * lot a-t-il été bloqué, et quand — mais n'étaient exposées nulle part,
 * y compris sur ce gabarit. Corrigé : `resoudreLotsConcernes`
 * (`apps/api/src/documents/donnees.ts`) les transmet désormais — la preuve
 * sur la chaîne RÉELLE (dépôt → assemblage → gabarit → PDF) vit dans
 * `audit-documents.test.ts`, pas ici : ce fichier reste volontairement limité
 * au gabarit seul, construit sur des données à la main.
 *
 * NUANCE À NE PAS PERDRE : `motifStatutLibelle`/`dateChangementStatut` ne
 * portent que le motif du DERNIER changement, jamais l'historique complet.
 * Une mise en quarantaine suivie d'une levée affiche donc le motif de la
 * LEVÉE, pas celui de la quarantaine. Le champ `statut` (statut ACTUEL, lui
 * TOUJOURS renseigné) doit donc apparaître à côté du motif, jamais à sa
 * place — sans quoi un lot afficherait « Levée de quarantaine » sans qu'on
 * sache si c'est bien redevenu son état réel aujourd'hui.
 */
describe('Gabarit registre AFSCA — statut actuel et dernier changement de statut d’un lot concerné', () => {
  const lotBase: Omit<DonneesRegistreAfscaLotConcerne, 'statut'> = {
    ingredientNom: 'Farine de froment T55 (test)',
    fournisseurNom: 'Moulin de test (test)',
    numeroLotFournisseur: 'LOT-TEST-042',
    dateDlc: null,
  };

  const nonConformiteBase: Omit<DonneesRegistreAfscaNonConformite, 'lot'> = {
    dateConstat: '2026-07-10',
    type: 'Rappel fournisseur',
    description: 'Farine potentiellement contaminée (test).',
    gravite: 'critique',
    actionCorrective: null,
    dateResolution: null,
  };

  it('affiche le statut ACTUEL, coloré, et le motif et la date du dernier changement quand le dépôt les fournit', () => {
    const { html } = registreAfscaMensuel(
      donneesMinimales({
        nonConformites: [
          {
            ...nonConformiteBase,
            lot: {
              ...lotBase,
              statut: 'bloque',
              motifStatutLibelle: 'Bloqué suite à un rappel fournisseur',
              dateChangementStatut: '2026-07-10T09:15:00.000Z',
            },
          },
        ],
      }),
    );

    expect(html).toContain('Statut : ');
    // « Bloqué » est le statut le plus grave de ce document : même couleur
    // que le dépassement de seuil sur les relevés de température.
    expect(html).toContain('<span class="statut-depassement">Bloqué</span>');
    expect(html).toContain('Dernier changement de statut');
    expect(html).toContain('Bloqué suite à un rappel fournisseur');
    expect(html).toContain('10/07/2026');
    // Le numéro de lot, seul identifiant citable au téléphone, reste affiché
    // EN PLUS de la mention, jamais remplacé par elle.
    expect(html).toContain('LOT-TEST-042');
  });

  it(
    'après une levée de quarantaine, affiche le statut ACTUEL « Disponible » à côté du motif de ' +
      'la LEVÉE — jamais le motif seul, qui pourrait laisser croire le lot encore en quarantaine',
    () => {
      const { html } = registreAfscaMensuel(
        donneesMinimales({
          nonConformites: [
            {
              ...nonConformiteBase,
              lot: {
                ...lotBase,
                statut: 'disponible',
                motifStatutLibelle: 'Levée de quarantaine après vérification',
                dateChangementStatut: '2026-07-12T10:00:00.000Z',
              },
            },
          ],
        }),
      );

      // Le statut ACTUEL, sans mise en forme d'alerte : plus rien à signaler.
      expect(html).toContain('Statut : Disponible');
      // Le motif du DERNIER changement reste visible À CÔTÉ, jamais à la
      // place du statut actuel.
      expect(html).toContain(
        'Dernier changement de statut : Levée de quarantaine après vérification',
      );
    },
  );

  it("affiche le statut ACTUEL même quand le lot n'a jamais changé de statut (motif à `null`)", () => {
    const { html } = registreAfscaMensuel(
      donneesMinimales({
        nonConformites: [
          {
            ...nonConformiteBase,
            lot: {
              ...lotBase,
              statut: 'disponible',
              motifStatutLibelle: null,
              dateChangementStatut: null,
            },
          },
        ],
      }),
    );

    expect(html).toContain('Statut : Disponible');
    expect(html).not.toContain('Dernier changement de statut');
    expect(html).toContain('LOT-TEST-042');
  });

  it(
    "affiche le statut ACTUEL et n'affiche AUCUNE mention de changement, sans planter, quand " +
      'motif et date sont absents (`undefined`) — robustesse défensive du gabarit, indépendante ' +
      'de ce que `donnees.ts` fournit en pratique',
    () => {
      const lot: DonneesRegistreAfscaLotConcerne = { ...lotBase, statut: 'quarantaine' };
      expect(() =>
        registreAfscaMensuel(donneesMinimales({ nonConformites: [{ ...nonConformiteBase, lot }] })),
      ).not.toThrow();

      const { html } = registreAfscaMensuel(
        donneesMinimales({ nonConformites: [{ ...nonConformiteBase, lot }] }),
      );
      expect(html).toContain('<span class="statut-alerte">En quarantaine</span>');
      expect(html).not.toContain('Dernier changement de statut');
      expect(html).toContain('LOT-TEST-042');
    },
  );
});

/**
 * Identité de l'exploitant (audit `docs/31-DOCUMENTS-OUVERTS.md` §5 : « aucune
 * notion d'exploitant n'existait nulle part dans le dépôt »).
 *
 * Deux points vérifiés ici, sur le HTML produit par le gabarit :
 *  - chaque champ vide imprime un repère visuellement distinct
 *    (`.statut-alerte`), INDÉPENDAMMENT des autres — jamais une ligne blanche ;
 *  - la forme compacte (nom + n° d'entreprise) atterrit dans `options.pied`,
 *    PAS seulement dans le corps — c'est `options.pied` qui devient
 *    `footerTemplate` pour Playwright (`rendu.ts`) et qui, à ce titre, est le
 *    SEUL mécanisme de ce document réellement répété sur chaque page. Un test
 *    sur le HTML ne peut pas voir la répétition physique par Chromium sur une
 *    vraie page 2 — cette preuve-là vit dans le rapport de cette mission
 *    (PDF réellement rendu et relu), pas ici (même limite que le commentaire
 *    de `rendu.test.ts` sur `options.pied`).
 */
describe('Gabarit registre AFSCA — identité de l’exploitant', () => {
  const EXPLOITANT_COMPLET = {
    nom: 'Jean Dupont — Crêpes ambulantes',
    adresse: 'Rue de la Batte 1, 4000 Liège',
    numeroEntreprise: 'BE0123.456.789',
    numeroEnregistrementAfsca: 'AFSCA-12345',
  };

  it('imprime les quatre champs dans le corps (entete) quand ils sont tous connus', () => {
    const { html } = registreAfscaMensuel(donneesMinimales({ exploitant: EXPLOITANT_COMPLET }));
    expect(html).toContain('Jean Dupont — Crêpes ambulantes');
    expect(html).toContain('Rue de la Batte 1, 4000 Liège');
    expect(html).toContain('BE0123.456.789');
    expect(html).toContain('AFSCA-12345');
    expect(html).not.toContain('non renseigné');
    expect(html).not.toContain('non renseignée');
  });

  it(
    'imprime un repère `.statut-alerte` PAR CHAMP manquant, indépendamment des ' +
      'autres, jamais une ligne blanche',
    () => {
      const { html } = registreAfscaMensuel(
        donneesMinimales({
          exploitant: {
            nom: 'Jean Dupont — Crêpes ambulantes',
            adresse: null,
            numeroEntreprise: null,
            numeroEnregistrementAfsca: 'AFSCA-12345',
          },
        }),
      );
      // Le nom et le numéro AFSCA sont connus : ils s'impriment normalement.
      expect(html).toContain('Jean Dupont — Crêpes ambulantes');
      expect(html).toContain('AFSCA-12345');
      // L'adresse et le numéro d'entreprise sont absents : repère distinct,
      // jamais une valeur fabriquée ni un blanc silencieux.
      expect(html).toContain(
        '<span class="statut-alerte">Adresse non renseignée — à compléter dans Paramètres</span>',
      );
      expect(html).toContain(
        '<span class="statut-alerte">Numéro d\'entreprise non renseigné — à compléter dans Paramètres</span>',
      );
    },
  );

  it('imprime un repère `.statut-alerte` pour les QUATRE champs quand rien n’est renseigné', () => {
    const { html } = registreAfscaMensuel(donneesMinimales()); // EXPLOITANT_VIDE par défaut
    expect(html).toContain('Nom non renseigné — à compléter dans Paramètres');
    expect(html).toContain('Adresse non renseignée — à compléter dans Paramètres');
    expect(html).toContain("Numéro d'entreprise non renseigné — à compléter dans Paramètres");
    expect(html).toContain(
      "Numéro d'enregistrement AFSCA non renseigné — à compléter dans Paramètres",
    );
  });

  it(
    'la forme compacte (nom + n° entreprise) atteint `options.pied`, le seul ' +
      'mécanisme réellement répété sur chaque page',
    () => {
      const { options } = registreAfscaMensuel(
        donneesMinimales({ exploitant: EXPLOITANT_COMPLET }),
      );
      expect(options.pied).toBeDefined();
      expect(options.pied).toContain('Jean Dupont — Crêpes ambulantes');
      expect(options.pied).toContain('BE0123.456.789');
      // La forme compacte n'inclut PAS l'adresse ni le numéro AFSCA — c'est le
      // bloc complet d'`entete()` qui les porte, page 1 seulement.
      expect(options.pied).not.toContain('AFSCA-12345');
    },
  );

  it('`options.pied` signale aussi un exploitant non renseigné, jamais silencieusement', () => {
    const { options } = registreAfscaMensuel(donneesMinimales());
    expect(options.pied).toContain('nom non renseigné');
    expect(options.pied).toContain("n° d'entreprise non renseigné");
  });

  /**
   * DÉFAUT CORRIGÉ (audit `docs/31-DOCUMENTS-OUVERTS.md` §5) : la mention
   * légale du registre n'apparaissait qu'en dernier paragraphe du corps, donc
   * mécaniquement sur la seule DERNIÈRE page d'un registre multi-page. Elle
   * reste dans le corps (lisible en entier sur la dernière page) ET doit
   * désormais ATTEINDRE `options.pied`, pour se répéter sur CHAQUE page.
   */
  it('la mention légale AFSCA atteint désormais `options.pied`, pas seulement le corps', () => {
    const { html, options } = registreAfscaMensuel(donneesMinimales());
    expect(html).toContain('ne remplace ni un contrôle AFSCA');
    expect(options.pied).toContain('ne remplace ni un contrôle AFSCA');
  });
});
