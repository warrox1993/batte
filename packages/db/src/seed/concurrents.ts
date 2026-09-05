/**
 * Concurrents de DÉMONSTRATION (fiche `docs/demandes/08-FICHES-CONCURRENTS.md`)
 * — les deux vendeurs de crêpes déjà repérés à La Batte, avec un historique de
 * prix et une observation qualitative chacun, pour que le module ne s'ouvre
 * jamais sur un écran vide.
 *
 * Comme le reste de `demonstration.ts` : tout nom est FICTIF et porte le
 * préfixe `[démo] ` — aucun commerce réel n'est nommé, aucun prix réel n'est
 * supposé (CLAUDE.md §7, zéro donnée personnelle : un concurrent est un
 * commerce, pas une personne, donc pas de nom de gérant ici non plus).
 *
 * Idempotent PAR CONCURRENT, et non par ligne de produit/observation : les
 * dates de ce jeu de données sont relatives au jour du seed (`ajouterJours`),
 * donc un contrôle « cette ligne existe-t-elle déjà à CETTE date » échouerait
 * silencieusement si le seed est rejoué un autre jour. On vérifie donc
 * l'existence du concurrent lui-même (par nom + lieu) et, s'il existe déjà,
 * on considère tout son jeu de démonstration comme déjà posé.
 */

import { ajouterJours, jourCivilBelge, maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { and, eq } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { concurrent, concurrentObservation, concurrentProduit, lieuMarche } from '../schema.js';

export type ResultatSeedConcurrents = {
  concurrents: number;
  produits: number;
  observations: number;
};

const PREFIXE_DEMO = '[démo] ';

type TypeOffre = 'crepes' | 'gaufres' | 'autre_sucre' | 'sale' | 'mixte';
type Positionnement = 'bas_de_gamme' | 'standard' | 'premium';
type AffluenceEstimee = 'nulle' | 'faible' | 'moyenne' | 'forte';

type DefinitionProduit = {
  readonly nomProduit: string;
  readonly prixCents: number;
  readonly description: string | null;
  /** Jours AVANT aujourd'hui (jour civil belge) : toujours dans le passé. */
  readonly joursAvant: number;
};

type DefinitionObservation = {
  readonly joursAvant: number;
  readonly affluenceEstimee: AffluenceEstimee;
  readonly fileAttente: boolean;
  readonly notes: string;
};

type DefinitionConcurrent = {
  readonly nom: string;
  readonly typeOffre: TypeOffre;
  readonly positionnement: Positionnement;
  readonly emplacementObserve: string;
  readonly qualitePercue: number;
  readonly notesGenerales: string;
  /** Historisé à dessein : deux relevés à des dates différentes pour le
   * premier concurrent, afin que l'écran montre une VRAIE évolution de prix
   * et non un simple « dernier relevé » isolé (fiche 08). */
  readonly produits: readonly DefinitionProduit[];
  readonly observation: DefinitionObservation;
};

const CONCURRENTS: readonly DefinitionConcurrent[] = [
  {
    nom: `${PREFIXE_DEMO}Crêperie du Quai`,
    typeOffre: 'crepes',
    positionnement: 'standard',
    emplacementObserve: 'Extrémité du quai, côté Meuse, à environ 80 m du stand.',
    qualitePercue: 3,
    notesGenerales: "Vendeur installé de longue date, clientèle d'habitués.",
    produits: [
      {
        nomProduit: `${PREFIXE_DEMO}Crêpe sucre`,
        prixCents: 280,
        description: 'Crêpe nature + sucre',
        joursAvant: 35,
      },
      // Même produit, prix relevé plus tard : c'est l'ÉVOLUTION que
      // `concurrent_produit` historise (fiche 08), pas un simple dernier prix.
      {
        nomProduit: `${PREFIXE_DEMO}Crêpe sucre`,
        prixCents: 300,
        description: 'Crêpe nature + sucre',
        joursAvant: 7,
      },
    ],
    observation: {
      joursAvant: 7,
      affluenceEstimee: 'moyenne',
      fileAttente: false,
      notes:
        'File courte au moment de la visite (14 h). Pâte visuellement plus épaisse que la nôtre.',
    },
  },
  {
    nom: `${PREFIXE_DEMO}La Petite Bretonne`,
    typeOffre: 'crepes',
    positionnement: 'premium',
    emplacementObserve: "Face à l'entrée principale du marché, stand couvert.",
    qualitePercue: 4,
    notesGenerales:
      'Propose aussi des galettes salées ; file d’attente régulière le dimanche matin.',
    produits: [
      {
        nomProduit: `${PREFIXE_DEMO}Crêpe froment nature`,
        prixCents: 350,
        description: 'Beurre + sucre',
        joursAvant: 14,
      },
      {
        nomProduit: `${PREFIXE_DEMO}Galette sarrasin jambon-fromage`,
        prixCents: 650,
        description: null,
        joursAvant: 14,
      },
    ],
    observation: {
      joursAvant: 14,
      affluenceEstimee: 'forte',
      fileAttente: true,
      notes:
        "File d'attente de 6 personnes à 10 h. Prix plus élevés que les nôtres sur toute la carte.",
    },
  },
];

export function seedConcurrentsDemonstration(base: BaseBatte): ResultatSeedConcurrents {
  // Rattaché à « La Batte », posé par `seedLieu` juste avant ce module dans
  // `seedDemonstration` : sans lieu, un concurrent n'a pas de sens (fiche 08,
  // « un concurrent est observé à un endroit précis »).
  const lieu = base
    .select({ id: lieuMarche.id })
    .from(lieuMarche)
    .where(eq(lieuMarche.nom, 'La Batte'))
    .get();
  if (lieu === undefined) return { concurrents: 0, produits: 0, observations: 0 };

  const maintenant = maintenantUtc();
  const aujourdHui = jourCivilBelge(new Date());

  let concurrentsInseres = 0;
  let produitsInseres = 0;
  let observationsInserees = 0;

  for (const definition of CONCURRENTS) {
    const existant = base
      .select({ id: concurrent.id })
      .from(concurrent)
      .where(and(eq(concurrent.nom, definition.nom), eq(concurrent.lieuId, lieu.id)))
      .get();
    if (existant !== undefined) continue;

    const idConcurrent = nouvelIdentifiant();
    const datesProduits = definition.produits.map((p) => ajouterJours(aujourdHui, -p.joursAvant));
    const dateObservation = ajouterJours(aujourdHui, -definition.observation.joursAvant);
    // Dernière observation = la plus récente des dates ci-dessus, comme le
    // ferait `avancerDerniereObservation` du dépôt à chaque ajout réel.
    const derniereObservation = [...datesProduits, dateObservation].sort().at(-1)!;

    base
      .insert(concurrent)
      .values({
        id: idConcurrent,
        nom: definition.nom,
        lieuId: lieu.id,
        typeOffre: definition.typeOffre,
        positionnement: definition.positionnement,
        emplacementObserve: definition.emplacementObserve,
        qualitePercue: definition.qualitePercue,
        dateDerniereObservation: derniereObservation,
        notesGenerales: definition.notesGenerales,
        actif: true,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    concurrentsInseres += 1;

    definition.produits.forEach((produit, index) => {
      base
        .insert(concurrentProduit)
        .values({
          id: nouvelIdentifiant(),
          concurrentId: idConcurrent,
          nomProduit: produit.nomProduit,
          prixCents: produit.prixCents,
          description: produit.description,
          dateObservation: datesProduits[index]!,
          creeLe: maintenant,
          modifieLe: maintenant,
        })
        .run();
      produitsInseres += 1;
    });

    base
      .insert(concurrentObservation)
      .values({
        id: nouvelIdentifiant(),
        concurrentId: idConcurrent,
        dateObservation,
        affluenceEstimee: definition.observation.affluenceEstimee,
        fileAttente: definition.observation.fileAttente,
        notes: definition.observation.notes,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
    observationsInserees += 1;
  }

  return {
    concurrents: concurrentsInseres,
    produits: produitsInseres,
    observations: observationsInserees,
  };
}
