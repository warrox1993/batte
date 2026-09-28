import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BASE_POINTS,
  formaterDate,
  formaterEcartPourcent,
  formaterEuros,
  formaterMontant,
  formaterPourcent,
  ouTiret,
  schemaComparateur,
  schemaPrevision,
  TIRET_ABSENT,
  type Comparateur,
  type Prevision,
} from '@batte/core';
import { BoutonDocument } from '../composants/BoutonDocument';
import { MessageErreur } from '../composants/EncartErreur';
import { Panneau } from '../composants/Panneau';
import { Tableau, type ColonneTableau } from '../composants/Tableau';
import { EtatVide } from '../composants/EtatVide';
import { DemandeClaude } from '../composants/DemandeClaude';
import { ErreurApi, requeteApi } from '../lib/api';

/**
 * Ecran « Prochaine session » — la decision de production (docs/01 module 5,
 * docs/03, docs/06).
 *
 * C'est l'ecran ou l'application DIT quoi faire (docs/07, mecanisme 1). Le
 * nombre de crepes a produire est donc le seul `text-3xl` de l'ecran ; tout le
 * reste existe pour le justifier.
 *
 * Le point pedagogique central : la recommandation paraitra TROP HAUTE. Une
 * rupture coute la marge entiere, un invendu seulement la pate — produire la
 * mediane est economiquement faux. L'ecran explique donc le quantile cible au
 * lieu de se contenter de l'afficher.
 *
 * Aucun calcul metier ici (CLAUDE.md §3 regle 1) : tout vient de `/api/prevision`.
 */

type EtatEcran =
  | { statut: 'chargement' }
  | { statut: 'aucune_session'; message: string }
  /**
   * D-082 (`docs/05-DECISIONS.md`) : zéro session close sur le lieu de la
   * prochaine session → aucune prévision, jamais un chiffre appuyé
   * entièrement sur l'estimation de départ. Distinct de `aucune_session` :
   * ici une session EST bien planifiée, c'est l'historique du LIEU qui
   * manque. Même mécanisme que `aucune_session` — code d'erreur métier
   * (`premier_passage_lieu`, `apps/api/src/routes/previsions.ts`) traduit en
   * état d'écran dédié, jamais en encadré rouge générique.
   */
  | { statut: 'premier_passage'; message: string }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; prevision: Prevision };

type EtatArchivage =
  | { statut: 'inactif' }
  | { statut: 'en_cours' }
  | { statut: 'succes'; message: string }
  | { statut: 'erreur'; message: string };

/** Effacement d'un message de succes (docs/07 §4.7 : succes 5 s, erreur persistante). */
const DELAI_SUCCES_MS = 5000;

type LigneFacteur = {
  cle: string;
  libelle: string;
  valeur: string;
  neutre: boolean;
};

/** Multiplicateur lisible : 10000 bp -> « × 1,00 ». */
export function formaterFacteur(bp: number): string {
  return `× ${(bp / BASE_POINTS).toFixed(2).replace('.', ',')}`;
}

/**
 * Libellé de la ligne « Événement » du tableau de facteurs.
 *
 * `evenements[].impactBp` (`schemaPrevision`, `packages/core/src/contrats/
 * previsions.ts:195`) était calculé, testé, servi par `GET /prevision`, et
 * jamais lu par cet écran (audit du 31/07/2026, docs/21 §2.10) : seul le
 * facteur COMBINÉ (`facteurs.evenementBp`) était affiché. `facteurEvenementBp`
 * (`packages/db/src/depots/previsions.ts`) est le PRODUIT des facteurs
 * individuels — dès que deux événements coïncident le même jour, le combiné
 * ne permet plus de retrouver la contribution de chacun. Le format
 * `formaterFacteur` (multiplicateur × 1,xx) est réutilisé tel quel : c'est
 * exactement le même genre de nombre que celui déjà affiché pour le facteur
 * combiné, juste isolé par événement.
 *
 * Fonction PURE et exportée : son test prouve la composition du texte, pas
 * son rendu réel (celui-ci relève de `ProchaineSession.montage.test.tsx`).
 */
export function libelleEvenementsPrevision(evenements: Prevision['evenements']): string {
  if (evenements.length === 0) return 'Événement — aucun ce jour-là';
  return `Événement — ${evenements
    .map((e) => `${e.nom} (${formaterFacteur(e.impactBp)}, ${e.mesure ? 'mesuré' : 'estimé'})`)
    .join(', ')}`;
}

/**
 * Nomme ce qui manque pour que l'arbitrage rupture / invendu repose sur de
 * vrais chiffres, et ce que ce manque a produit à la place.
 *
 * POURQUOI CETTE PHRASE EXISTE. `coutsNewsvendor` (`packages/db`) doit rendre
 * DEUX NOMBRES au moteur, même quand rien ne permet de les estimer : sans eux
 * aucune quantité ne pourrait être proposée (mode dégradé, CLAUDE.md §5). Il
 * rend donc `0`, et dit par `coutInvenduConnu` / `prixMoyenConnu` que ce `0`
 * est une SENTINELLE. Sans cet avertissement, l'écran affirmait « un invendu
 * coûte 0,00 € de pâte » : c'est-à-dire que surproduire est gratuit, présenté
 * comme la CAUSE du volume recommandé juste au-dessus.
 *
 * `null` quand les deux sont connus — il n'y a alors rien à avertir, et un
 * bandeau affiché à chaque ouverture cesserait d'être lu le jour où il
 * compterait.
 *
 * Fonction PURE et exportée : elle compose un texte, elle ne calcule aucun
 * chiffre (CLAUDE.md §3 règle 1).
 */
export function avertissementCoutsPrevision(couts: Prevision['couts']): string | null {
  if (couts.coutInvenduConnu && couts.prixMoyenConnu) return null;

  const manques: string[] = [];
  // L'ordre suit celui de la phrase affichée : la rupture d'abord, l'invendu
  // ensuite, pour que le lecteur retrouve chaque « — » dans l'explication.
  if (!couts.prixMoyenConnu) {
    manques.push('le prix de vente moyen d’une crêpe (aucun produit transformé avec son prix)');
  }
  if (!couts.coutInvenduConnu) {
    manques.push(
      'le coût matière d’une crêpe (aucune production, et aucune recette dont tous les ' +
        'ingrédients ont un conditionnement au prix connu)',
    );
  }

  return (
    `Chiffre inconnu, pas nul : ${manques.join(' et ')}. Le volume ci-dessus a donc été ` +
    'arbitré comme si cette valeur était de zéro. Renseignez-la pour que la comparaison ' +
    'rupture / invendu repose sur un vrai chiffre.'
  );
}

/**
 * Le TROISIÈME cas de l'intervalle : ni mesuré, ni inconnu — SANS OBJET.
 *
 * POURQUOI CETTE PHRASE EXISTE (D-098). Le prochain jour de marché de La Batte
 * est le dimanche, et la fonction qui le calcule rend LE JOUR MÊME quand on y
 * est déjà : l'horizon de prévision vaut alors `0`. À horizon nul,
 * `ecartMeteoPrevueRealisee` (`packages/core/src/prevision/`) refuse par
 * construction, et c'est JUSTIFIÉ — une météo du jour même n'est plus une
 * prévision, il n'y a aucune incertitude d'horizon à faire payer à
 * l'intervalle. La ligne « Fiabilité météo » disparaît donc de la
 * décomposition, l'intervalle P10/P90 se resserre, et rien ne l'expliquait.
 * Le dimanche matin — le matin du marché, le moment exact où cet écran sert à
 * décider d'une quantité de pâte.
 *
 * REGISTRE. Ni alerte MÉTIER (le porteur n'a rien à corriger, il n'y a aucun
 * geste à faire), ni panne TECHNIQUE (rien n'a échoué) — les deux registres
 * que `EncartErreur.tsx` distingue. C'est un FAIT : ton neutre du texte
 * courant, aucun glyphe `▲`, aucun `role="alert"`.
 *
 * La formulation évite les deux contresens possibles : « en panne » (d'où
 * « il n'a simplement pas lieu d'être », et non « indisponible ») et « plus
 * précis » (d'où la dernière phrase, qui dit que le resserrement ne vient
 * d'aucun gain de certitude). Elle énonce ce qui est vrai AUJOURD'HUI sans
 * prétendre être l'unique raison d'une ligne absente : à horizon nul,
 * l'élargissement d'horizon n'a pas lieu d'être, que l'historique de couples
 * (prévu, réalisé) soit suffisant ou non.
 *
 * `null` dès que la session n'est pas ce jour même : une mention affichée les
 * six autres jours cesserait d'être lue le septième, celui où elle compte.
 *
 * Fonction PURE et exportée : elle compose un texte à partir d'un fait REÇU du
 * serveur (`horizonJours`, `schemaPrevision`), elle ne lit aucune horloge et
 * ne calcule aucun chiffre (CLAUDE.md §3 règle 1).
 */
export function mentionHorizonNul(horizonJours: Prevision['horizonJours']): string | null {
  if (horizonJours !== 0) return null;
  return (
    'Le marché a lieu aujourd’hui : la météo est observée, ce n’est plus une prévision. ' +
    'L’élargissement de l’intervalle lié à la fiabilité météo est donc sans objet — il ' +
    'n’est ni mesuré ni inconnu, il n’a simplement pas lieu d’être. L’intervalle est plus ' +
    'étroit pour cette seule raison, pas parce que la prévision serait plus sûre.'
  );
}

/* Un facteur neutre s'attenue, mais reste LISIBLE : `--ink-4` (2,58:1 sur
   blanc) est reserve par `index.css` au desactive et au tiret « — », pas a du
   texte qu'on doit pouvoir lire. « Saison — pas encore modelisee » est une
   information sur l'etat du modele, pas un element grise. `--ink-3` donne
   4,83:1, soit le minimum AA. */
/*
 * Corrigé le 01/08/2026 (docs/36-AUDIT-TROIS-RESOLUTIONS.md §2 rang 3,
 * mission « les deux écrans qui perdent du texte ») : mesuré à 1280 large,
 * 3 des 4 phrases de facteur tronquaient (« Météo — ensoleillé et chaud,
 * 26 °C — prior, ja… », « Saison — non modélisée — historique trop co… »,
 * « Tendance — non modélisée — encore 1/10 ses… »), résolu tout seul dès
 * 1920 — un vrai problème de PLACE (docs/07 §4.4 : 1280 est la seule des
 * trois cibles où la hauteur ET la largeur sont contraintes), pas un plafond
 * structurel comme celui de `Parametres.tsx`.
 *
 * DEUX CORRECTIONS, PAS UNE SEULE — la largeur seule ne suffit pas :
 *
 * 1. Largeurs : `Effet` n'a jamais besoin de plus qu'un multiplicateur fixe
 *    (« × 0,90 », 6 caractères, `formaterFacteur`) ; les 38 % qu'il recevait
 *    étaient très au-dessus de son propre besoin et manquaient à `Facteur`,
 *    dont les phrases (`meteo.explication`, `facteurs.saisonExplication`,
 *    `facteurs.tendanceExplication`, `libelleEvenementsPrevision`) sont plus
 *    longues et de longueur variable. Cédé : 62→75 % (Facteur), 38→25 %
 *    (Effet) — Effet garde une marge large (~2× la largeur de « × 0,90 »
 *    même à 1280) sans redonner le défaut que `Parametres.tsx` documente
 *    (une colonne numérique qui se resserre au point de tronquer un chiffre,
 *    CLAUDE.md §6).
 * 2. VÉRIFIÉ APRÈS LE POINT 1, à 1280 réel (`document.documentElement.
 *    clientWidth`, pas la taille demandée) : céder de la largeur à `Facteur`
 *    ADOUCIT la troncature (Météo rentre désormais) mais ne l'ÉLIMINE PAS —
 *    « Saison — non modélisée — historique trop court (1/4 mois distincts
 *    observés) » (78 caractères) dépasse encore de ~100 px le conteneur de
 *    ce panneau (~496 px à 1280, moitié de la grille à deux colonnes de
 *    `Decision`). Céder ENCORE plus à `Facteur` finirait par rétrécir
 *    `Effet` au point de tronquer un CHIFFRE — le défaut interdit — sans
 *    jamais totalement résorber une phrase de 78 caractères. La largeur
 *    seule ne peut donc pas garantir zéro troncature ici.
 *    `troncature: 'repli'` referme cet écart : contrairement à la citation
 *    légale de `Parametres.tsx` (déplacée hors du tableau) ou à
 *    l'identifiant AFSCA sans espace de docs/05-DECISIONS.md (qui s'enroule
 *    caractère par caractère), ces phrases sont du FRANÇAIS COURANT, pleines
 *    d'espaces et de tirets — `overflow-wrap: anywhere` y trouve toujours une
 *    coupure naturelle avant de couper un mot. La rangée ne grandit QUE
 *    quand une phrase déborde réellement (le compromis de densité déjà
 *    documenté par `index.css`) : à 1920/2560, où tout tient déjà sur une
 *    ligne, rien ne change visuellement. Même mécanisme déjà en usage plus
 *    bas dans CE fichier (`COLONNES_NOTRE_CARTE_SESSION`,
 *    `COLONNES_PRIX_CONCURRENTS_SESSION`) — pas une technique nouvelle.
 *
 * Toujours réparties à 100 % — voir `apps/api/src/tableau-largeurs-
 * colonnes.test.ts` (D-081), qui ne voit que l'arithmétique, jamais la
 * lisibilité (rappelée volontairement ici, voir aussi le rapport de mission).
 */
const COLONNES_FACTEURS: ReadonlyArray<ColonneTableau<LigneFacteur>> = [
  {
    cle: 'libelle',
    libelle: 'Facteur',
    largeur: '75%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (l) => <span className={l.neutre ? 'text-ink-3' : undefined}>{l.libelle}</span>,
    titre: (l) => l.libelle,
  },
  {
    cle: 'valeur',
    libelle: 'Effet',
    largeur: '25%',
    alignement: 'nombre',
    rendu: (l) => (
      <span className={l.neutre ? 'tabular-nums text-ink-3' : 'tabular-nums'}>{l.valeur}</span>
    ),
  },
];

/**
 * Décomposition intégrale, phrase par phrase (`prevision.explication`,
 * `construireExplication` dans `packages/core/src/prevision/moteur.ts`).
 *
 * N'EXISTAIT NULLE PART À L'ÉCRAN avant cette mission : le reste de l'écran
 * reconstruit sa PROPRE décomposition depuis les facteurs bruts (tableau
 * « D'où vient ce chiffre », panneau « Ce qui vous limite »…), ce qui perdait
 * deux phrases que le moteur produit et qu'aucun autre widget ne dit —
 * notamment « Volume transportable non renseigné — cette contrainte n'est pas
 * contrôlée », ajoutée la nuit du 30/07/2026. Générique et donc DÉFENSIF : un
 * moteur qui ajoute demain une phrase de plus l'affiche ici sans qu'aucun
 * écran n'ait besoin d'être retouché — « l'utilisateur doit pouvoir contester
 * chaque facteur » (docs/01 module 5) suppose que la phrase existe quelque
 * part à l'écran, pas seulement dans la réponse HTTP.
 *
 * S'AJOUTE à la décomposition par facteurs existante, ne la remplace pas :
 * celle-ci reste seule à distinguer visuellement les facteurs NEUTRES
 * (`text-ink-3`) des facteurs actifs, ce que la liste de phrases brutes ne
 * fait pas.
 */
export function ExplicationPrevision({ lignes }: { lignes: readonly string[] }) {
  if (lignes.length === 0) return null;
  return (
    <ul className="mt-bloc flex flex-col gap-groupe border-t border-line pt-bloc text-sm text-ink-2">
      {lignes.map((ligne) => (
        <li key={ligne}>{ligne}</li>
      ))}
    </ul>
  );
}

type LigneContrainte = {
  libelle: string;
  plafondCrepes: number;
  limitante: boolean;
};

const COLONNES_CONTRAINTES: ReadonlyArray<ColonneTableau<LigneContrainte>> = [
  {
    cle: 'libelle',
    libelle: 'Contrainte',
    largeur: '62%',
    alignement: 'texte',
    rendu: (l) => (
      <span className={l.limitante ? 'text-alerte' : undefined}>
        {l.limitante ? '▲ ' : ''}
        {l.libelle}
      </span>
    ),
    // L'infobulle doit COMMENCER par le texte réellement rendu. Elle laissait
    // tomber le « ▲ », qui est le seul signal NON CHROMATIQUE de la contrainte
    // limitante (docs/07 §4.5 : ces tableaux partent en PDF noir et blanc, et
    // un aplat de couleur ne survit pas — un glyphe si). Le perdre dans
    // l'infobulle, c'est le perdre pour qui ne distingue pas la couleur.
    titre: (l) => (l.limitante ? `▲ ${l.libelle} — contrainte limitante` : l.libelle),
  },
  {
    cle: 'plafond',
    // Unite dans l'EN-TETE, pas dans la cellule (docs/07 §4.5, regle 1) :
    // repeter « crepes » a chaque rangee est du bruit, et cela poussait la
    // colonne a tronquer.
    libelle: 'Plafond (crêpes)',
    largeur: '38%',
    alignement: 'nombre',
    rendu: (l) => (
      <span className={l.limitante ? 'tabular-nums text-alerte' : 'tabular-nums'}>
        {l.plafondCrepes}
      </span>
    ),
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   Prix concurrents du moment (docs/demandes/10 : « croisement explicite des
   données déjà présentes » — la carte propre et les prix concurrents
   n'avaient jusqu'ici aucune passerelle avec cet écran).
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Chemin du comparateur de prix filtré sur UN lieu précis.
 *
 * Extraite en fonction pure (même raison que `ExplicationPrevision`,
 * `formaterCoutAppelIa` plus bas) : le clic qui déclenche l'appel réel se
 * prouve au montage (`ProchaineSession.montage.test.tsx`) — cette fonction,
 * elle, se prouve sans rendu du tout.
 *
 * AVANT le 31/07/2026, ce filtre passait par `resoudreLieuIdParNom` (supprimée) :
 * le contrat `GET /api/prevision` ne renvoyait qu'un NOM de lieu
 * (`session.lieuNom`), et `lieu_marche.nom` n'étant pas contraint UNIQUE en
 * base (`packages/db/src/schema.ts`), deux emplacements du même nom rendaient
 * la résolution ambiguë — l'écran retombait alors sur un comparateur SANS
 * filtre, avec un avertissement. `session.lieuId` vient désormais directement
 * du contrat (`packages/core/src/contrats/previsions.ts`,
 * `schemaPrevision.session.lieuId` — la vraie clé étrangère de la session,
 * jamais un nom à deviner) : ce filtre est donc TOUJOURS fiable, plus de
 * second état à gérer.
 */
export function cheminComparateurDuLieu(lieuId: string): string {
  return `/concurrents/comparateur?lieuId=${lieuId}`;
}

const COLONNES_NOTRE_CARTE_SESSION: ReadonlyArray<
  ColonneTableau<Comparateur['notreCarte'][number]>
> = [
  {
    cle: 'nom',
    libelle: 'Notre produit',
    largeur: '65%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (p) => p.nom,
  },
  {
    cle: 'prix',
    libelle: 'Prix (€)',
    largeur: '35%',
    alignement: 'nombre',
    rendu: (p) => formaterMontant(p.prixCents),
  },
];

/**
 * Chaque ligne porte SA PROPRE date de relevé (`dateObservation`) : c'est ce
 * qui rend le comparateur affichable honnêtement — voir le commentaire
 * d'en-tête de `PanneauPrixConcurrents` sur pourquoi la MOYENNE, elle, ne
 * peut porter aucune date unique.
 */
const COLONNES_PRIX_CONCURRENTS_SESSION: ReadonlyArray<
  ColonneTableau<Comparateur['dernierPrixConcurrents'][number]>
> = [
  {
    cle: 'concurrent',
    libelle: 'Concurrent',
    largeur: '26%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (p) => p.concurrentNom,
  },
  {
    cle: 'produit',
    libelle: 'Produit',
    largeur: '30%',
    alignement: 'texte',
    troncature: 'repli',
    rendu: (p) => p.nomProduit,
  },
  {
    cle: 'prix',
    libelle: 'Prix (€)',
    largeur: '18%',
    alignement: 'nombre',
    rendu: (p) => formaterMontant(p.prixCents),
  },
  {
    cle: 'date',
    libelle: 'Relevé le',
    largeur: '26%',
    alignement: 'texte',
    rendu: (p) => formaterDate(p.dateObservation),
  },
];

type EtatPanneauConcurrents =
  | { statut: 'inactif' }
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; comparateur: Comparateur };

/**
 * Panneau DÉPLIABLE « Prix concurrents », replié par défaut.
 *
 * « En un clic », pas affiché en permanence : à 1280×720 la hauteur est la
 * ressource rare, pas la largeur (docs/07 §4.4), et les deux tableaux
 * ci-dessous (notre carte + derniers prix concurrents) ajouteraient plusieurs
 * rangées en permanence sur l'écran qui DIT quoi produire — la décision
 * elle-même (nombre de crêpes, panneau « À produire ») doit rester lisible
 * sans défiler. Un repli conserve l'accès en un clic sans ce coût.
 *
 * Reprend TEL QUEL le comparateur déjà servi à l'écran Concurrents
 * (`GET /concurrents/comparateur`, `packages/db/src/depots/concurrents.ts`) :
 * aucun calcul, aucune correspondance produit-à-produit inventée ici — la
 * seule chose que ce panneau fait de plus que Concurrents.tsx est de choisir
 * automatiquement le lieu à filtrer, celui de la session retenue
 * (`session.lieuId`, voir `cheminComparateurDuLieu`).
 *
 * FRAÎCHEUR : `moyenne.concurrentsPrixMoyenCents` est une moyenne de relevés
 * faits à des dates DIFFÉRENTES — aucune date unique ne peut lui être
 * attachée honnêtement, donc aucune ne l'est. Seul le détail ligne par ligne
 * (`dernierPrixConcurrents`, table ci-dessous) porte une date, et c'est LUI
 * qui rend le chiffre agrégé contestable — exactement la règle du mandat
 * (« n'affiche jamais un chiffre sans sa fraîcheur »).
 *
 * Toggle au clavier : le bouton reste monté hors du sous-arbre déplié (jamais
 * démonté par un rechargement), et `Échap` referme en rendant le focus au
 * bouton — même patron que `renegociationOuverte`/`saisieLibreOuverte`
 * (`Economies.tsx`), pas de risque D-079 (rien n'est démonté PENDANT un
 * chargement : au premier dépli, il n'y a encore rien à l'écran dont perdre
 * le focus).
 */
export function PanneauPrixConcurrents({
  session,
}: {
  readonly session: NonNullable<Prevision['session']>;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [etat, setEtat] = useState<EtatPanneauConcurrents>({ statut: 'inactif' });
  const boutonRef = useRef<HTMLButtonElement>(null);

  const charger = useCallback(async (): Promise<void> => {
    setEtat({ statut: 'chargement' });
    try {
      const brutComparateur = await requeteApi<unknown>(cheminComparateurDuLieu(session.lieuId));
      setEtat({ statut: 'pret', comparateur: schemaComparateur.parse(brutComparateur) });
    } catch (erreur) {
      setEtat({
        statut: 'erreur',
        message:
          erreur instanceof ErreurApi
            ? erreur.message
            : 'Le comparateur de prix n’a pas pu être calculé.',
      });
    }
  }, [session.lieuId]);

  function basculer(): void {
    const cible = !ouvert;
    setOuvert(cible);
    if (cible && etat.statut === 'inactif') void charger();
  }

  // « S'ouvre et se ferme au clavier » (docs/demandes/10) : Échap referme et
  // rend le focus au bouton bascule, jamais un focus perdu sur `<body>`.
  useEffect(() => {
    function surEchap(evenement: KeyboardEvent): void {
      if (evenement.key !== 'Escape' || !ouvert) return;
      setOuvert(false);
      boutonRef.current?.focus();
    }
    window.addEventListener('keydown', surEchap);
    return () => window.removeEventListener('keydown', surEchap);
  }, [ouvert]);

  return (
    <Panneau titre="Prix concurrents" sansRembourrage>
      <div className="flex items-center justify-between px-4 py-2">
        <p className="text-xs text-ink-3">
          Notre carte face aux derniers prix relevés à {session.lieuNom} — même comparateur que
          l’écran Concurrents.
        </p>
        <button
          type="button"
          ref={boutonRef}
          onClick={basculer}
          aria-expanded={ouvert}
          className="h-controle shrink-0 rounded-sm border border-line-field px-3 text-sm text-ink-2 hover:bg-surface-sunken"
        >
          {ouvert ? 'Masquer' : 'Voir les prix concurrents'}
        </button>
      </div>

      {ouvert && (
        <div className="border-t border-line px-4 py-3">
          {etat.statut === 'chargement' && (
            <p className="text-sm text-ink-3">Calcul du comparateur…</p>
          )}
          {etat.statut === 'erreur' && <MessageErreur message={etat.message} />}
          {etat.statut === 'pret' && (
            <div className="flex flex-col gap-bloc">
              <div className="flex flex-wrap items-end gap-section">
                <div>
                  <p className="text-2xs uppercase text-ink-3">Moyenne de nos crêpes</p>
                  <p className="num text-left text-lg text-ink">
                    {ouTiret(etat.comparateur.moyenne.notrePrixMoyenCrepeCents, formaterEuros)}
                  </p>
                </div>
                <div>
                  <p className="text-2xs uppercase text-ink-3">
                    Moyenne concurrents équivalents (
                    {etat.comparateur.moyenne.nbConcurrentsEquivalents})
                  </p>
                  <p className="num text-left text-lg text-ink">
                    {ouTiret(etat.comparateur.moyenne.concurrentsPrixMoyenCents, formaterEuros)}
                  </p>
                </div>
                <div>
                  <p className="text-2xs uppercase text-ink-3">Écart</p>
                  <p className="num text-left text-lg text-ink">
                    {etat.comparateur.moyenne.ecartBp === null
                      ? TIRET_ABSENT
                      : formaterEcartPourcent(etat.comparateur.moyenne.ecartBp)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-bloc lg:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-2xs uppercase text-ink-3">
                    Notre carte (produits actifs)
                  </h3>
                  <Tableau
                    colonnes={COLONNES_NOTRE_CARTE_SESSION}
                    lignes={etat.comparateur.notreCarte}
                    cleLigne={(p) => p.produitVenteId}
                    etatVide={<EtatVide variante="normal" texte="Aucun produit actif en carte." />}
                  />
                </div>
                <div>
                  <h3 className="mb-1 text-2xs uppercase text-ink-3">
                    Derniers prix relevés chez les concurrents équivalents
                  </h3>
                  <Tableau
                    colonnes={COLONNES_PRIX_CONCURRENTS_SESSION}
                    lignes={etat.comparateur.dernierPrixConcurrents}
                    cleLigne={(p) => `${p.concurrentId}-${p.nomProduit}`}
                    etatVide={
                      <EtatVide
                        variante="normal"
                        texte="Aucun prix relevé chez un concurrent équivalent pour l’instant."
                      />
                    }
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Panneau>
  );
}

/** `EtatEcran` privé des deux variantes qui ne se rendent jamais depuis une erreur. */
type EtatApresErreur = Exclude<EtatEcran, { statut: 'chargement' } | { statut: 'pret' }>;

/**
 * Traduit une erreur de `GET /prevision` en état d'écran — extrait en
 * fonction PURE et exportée pour que la
 * distinction entre TROIS « rien à afficher » soit prouvable sans monter le
 * composant : aucune session planifiée, premier passage sur ce lieu
 * (« aucune prévision », D-082, `docs/05-DECISIONS.md`), et une vraie erreur.
 *
 * Les deux premiers ne sont PAS des erreurs au sens de l'écran : ce sont des
 * états normaux, traduits en encadrés informatifs (`EtatVide`), jamais en
 * encadré rouge — seul le troisième (`erreur`) l'est. Confondre « premier
 * passage » avec une erreur générique referait exactement le défaut que
 * D-082 corrige côté moteur : une absence traitée comme un problème plutôt
 * que comme un fait.
 */
export function etatDepuisErreurPrevision(erreur: unknown): EtatApresErreur {
  if (erreur instanceof ErreurApi && erreur.code === 'aucune_session_planifiee') {
    return { statut: 'aucune_session', message: erreur.message };
  }
  if (erreur instanceof ErreurApi && erreur.code === 'premier_passage_lieu') {
    return { statut: 'premier_passage', message: erreur.message };
  }
  return {
    statut: 'erreur',
    message:
      erreur instanceof ErreurApi ? erreur.message : 'La prévision n’a pas pu être calculée.',
  };
}

export default function ProchaineSession() {
  const [etat, setEtat] = useState<EtatEcran>({ statut: 'chargement' });
  const [archivage, setArchivage] = useState<EtatArchivage>({ statut: 'inactif' });
  /**
   * Verrou synchrone (motif `BoutonDocument.tsx`) : `archivage.statut` ne
   * suffit pas car `setArchivage` est asynchrone, donc deux clics rapides
   * verraient tous deux `inactif` avant le premier recommit.
   */
  const verrouArchivage = useRef(false);

  const charger = useCallback(async (rafraichirMeteo: boolean) => {
    setEtat({ statut: 'chargement' });
    try {
      const brut = await requeteApi<unknown>(
        `/prevision${rafraichirMeteo ? '?rafraichirMeteo=1' : ''}`,
      );
      setEtat({ statut: 'pret', prevision: schemaPrevision.parse(brut) });
    } catch (erreur) {
      setEtat(etatDepuisErreurPrevision(erreur));
    }
  }, []);

  useEffect(() => {
    void charger(false);
  }, [charger]);

  useEffect(() => {
    if (archivage.statut !== 'succes') return undefined;
    const minuteur = window.setTimeout(() => setArchivage({ statut: 'inactif' }), DELAI_SUCCES_MS);
    return () => window.clearTimeout(minuteur);
  }, [archivage]);

  const archiver = async (): Promise<void> => {
    if (verrouArchivage.current) return;
    if (etat.statut !== 'pret') return;
    verrouArchivage.current = true;
    setArchivage({ statut: 'en_cours' });
    try {
      await requeteApi('/prevision/archiver', {
        method: 'POST',
        body: JSON.stringify({ sessionId: etat.prevision.session?.id ?? null }),
      });
      setArchivage({
        statut: 'succes',
        message: 'Prévision archivée. Elle sera comparée au réalisé après le marché.',
      });
    } catch (erreur) {
      setArchivage({
        statut: 'erreur',
        message: erreur instanceof ErreurApi ? erreur.message : 'L’archivage a échoué.',
      });
    } finally {
      verrouArchivage.current = false;
    }
  };

  return (
    <div className="flex flex-col gap-bloc">
      <div className="flex h-barre items-center justify-between">
        <h1 className="text-lg text-ink">Prochaine session</h1>
        {etat.statut === 'pret' && (
          <div className="flex items-center gap-groupe">
            <button
              type="button"
              onClick={() => void charger(true)}
              className="h-controle rounded-sm border border-line-field px-3 text-sm text-ink-2 hover:bg-surface-sunken"
            >
              Rafraîchir la météo
            </button>
            {/*
             * Brief avant-marché (mission du 31/07/2026, même motif que D-087 —
             * « une capacité existe, testée, aucun écran ne l'appelle ») :
             * `GET /prevision/brief` (`apps/api/src/routes/previsions.ts`)
             * existait, testée, et n'était appelée par AUCUN écran — le
             * document qu'on relit le samedi soir était donc inatteignable
             * sans forger une requête à la main.
             *
             * Document DÉTERMINISTE, pas un appel Claude : `rendrePdf`
             * (`apps/api/src/documents/rendu.ts`) passe par Playwright/HTML,
             * exactement comme le rapport de session ou l'affichette
             * allergènes — aucun garde-fou de dépense (CLAUDE.md §5) ne
             * s'applique ici, donc `BoutonDocument` (même composant que ces
             * deux autres documents) suffit, sans état « mode dégradé IA ».
             */}
            <BoutonDocument
              chemin="/prevision/brief"
              libelle="Télécharger le brief (PDF)"
              libelleAttente="Édition du brief…"
            />
            <button
              type="button"
              onClick={() => void archiver()}
              aria-disabled={archivage.statut === 'en_cours'}
              aria-busy={archivage.statut === 'en_cours'}
              className={`h-controle rounded-sm bg-accent px-3 text-sm text-on-accent hover:bg-accent-hover ${
                archivage.statut === 'en_cours' ? 'cursor-not-allowed opacity-50' : ''
              }`}
            >
              {archivage.statut === 'en_cours' ? 'Archivage…' : 'Archiver cette prévision'}
            </button>
          </div>
        )}
      </div>

      {archivage.statut === 'succes' && (
        <p
          role="status"
          className="rounded-sm border border-conforme-line bg-conforme-bg px-3 py-2 text-sm text-conforme"
        >
          {archivage.message}
        </p>
      )}
      {archivage.statut === 'erreur' && (
        <p className="rounded-sm border border-depassement-line bg-depassement-bg px-3 py-2 text-sm text-depassement">
          {archivage.message}
        </p>
      )}

      {etat.statut === 'chargement' && (
        <p className="text-sm text-ink-3">Calcul de la prévision…</p>
      )}

      {etat.statut === 'aucune_session' && (
        <EtatVide
          variante="premier-lancement"
          titre="Aucune session à venir"
          explication={etat.message}
        />
      )}

      {/*
       * D-082 : pas d'erreur, pas de conseil — l'application ne sait pas
       * combien produire pour un lieu jamais visité, elle le dit et s'arrête
       * là. Aucun bouton « Archiver »/« Rafraîchir la météo » ne s'affiche
       * ici (gardés par `etat.statut === 'pret'` dans l'en-tête ci-dessus) :
       * il n'y a rien à archiver ni aucune météo à rafraîchir tant qu'aucune
       * prévision n'existe.
       */}
      {etat.statut === 'premier_passage' && (
        <EtatVide
          variante="premier-lancement"
          titre="Premier passage : aucune prévision possible"
          explication={etat.message}
        />
      )}

      {etat.statut === 'erreur' && (
        <p className="rounded-sm border border-depassement-line bg-depassement-bg px-3 py-2 text-sm text-depassement">
          {etat.message}
        </p>
      )}

      {etat.statut === 'pret' && (
        <>
          <Decision prevision={etat.prevision} />
          <CommentaireClaude />
          <ResumeBriefClaude />
        </>
      )}
    </div>
  );
}

/**
 * Phrase affichée à côté d'un commentaire Claude reçu (mission « garde-fou de
 * dépense », audit du 30/07/2026) : CLAUDE.md §5 exige « un compteur de coût
 * par appel » — c'est ce widget qui le montre, au moment même où l'appel est
 * déclenché. C'est volontairement DIFFÉRENT de l'état du budget mensuel
 * (`AssistanceIa.tsx`) : « ce brief m'a coûté deux centimes » se retient,
 * « votre budget mensuel est à 12 % » ne se lit pas au même moment ni pour la
 * même raison (docs/00 §0 : « chaque écran fait une chose »).
 *
 * `coutCents` vient TEL QUEL de `schemaCommentaireIa` (`apps/api/src/ia/
 * client.ts`, calculé par `coutAppelCents` dans `packages/core`) : cette
 * fonction ne fait que le mettre en phrase, aucun calcul de plus.
 */
export function formaterCoutAppelIa(coutCents: number): string {
  return `Coût de cet appel : ${formaterEuros(coutCents)}.`;
}

/**
 * Commentaire Claude, a la demande.
 *
 * Volontairement NON chargé automatiquement : la décision de production doit
 * s'afficher sans attendre le réseau, et chaque appel coûte de l'argent
 * (CLAUDE.md §5). L'indisponibilité — pas de clé, plafond atteint, panne — est
 * un état normal affiché tel quel, jamais une erreur.
 */
function CommentaireClaude() {
  return (
    <Panneau titre="Avis de Claude">
      <DemandeClaude
        presentation="Claude peut commenter cette prévision : ce qui la rend prudente, à quoi faire attention. Il ne recalcule rien."
        libelleBouton="Demander un avis"
        appeler={() =>
          requeteApi<unknown>('/prevision/commenter', { method: 'POST', body: JSON.stringify({}) })
        }
        messageEchec="Le commentaire n’a pas pu être demandé."
        formaterCout={formaterCoutAppelIa}
      />
    </Panneau>
  );
}

/**
 * Résumé Claude du BRIEF avant-marché — panneau FRÈRE de `CommentaireClaude`
 * ci-dessus, jamais une modification de celui-ci : deux consignes Claude
 * différentes sous un même bouton empêcheraient de savoir laquelle on
 * déclenche (D-087 et suivantes, `docs/28-ORPHELINS-DERIVES.md` §2.1 — la
 * route existait, testée, sans le moindre appelant).
 *
 * DIFFÉRENT de `/prevision/commenter` : celui-ci reprend aussi les points de
 * vigilance imprimés sur le brief lui-même (stock sous seuil, lots proches de
 * leur DLC) que `commentaireDePrevision` ne voit pas — voir le commentaire de
 * la route `POST /prevision/brief/commenter`
 * (`apps/api/src/routes/previsions.ts`).
 *
 * Même garde-fou de dépense que `CommentaireClaude` : AUCUN chargement
 * automatique — `demander` ne part que d'un `onClick` — et le serveur
 * recalcule tout (corps JSON vide, jamais une prévision fournie par le
 * client, CLAUDE.md §5). L'indisponibilité (pas de clé, plafond atteint) est
 * un état normal affiché tel quel, jamais une erreur.
 */
function ResumeBriefClaude() {
  return (
    <Panneau titre="Résumé Claude du brief">
      <DemandeClaude
        presentation="Claude peut résumer le brief avant-marché : stock sous seuil, lots proches de leur DLC, en plus de la prévision. Il ne recalcule rien."
        libelleBouton="Résumer le brief"
        appeler={() =>
          requeteApi<unknown>('/prevision/brief/commenter', {
            method: 'POST',
            body: JSON.stringify({}),
          })
        }
        messageEchec="Le résumé n’a pas pu être demandé."
        formaterCout={formaterCoutAppelIa}
      />
    </Panneau>
  );
}

function Decision({ prevision }: { prevision: Prevision }) {
  const { session, baseline, meteo, facteurs, couts, contraintes, evenements } = prevision;

  // `null` quand les deux coûts sont connus, c'est-à-dire le cas normal.
  const avertissementCouts = avertissementCoutsPrevision(couts);
  // `null` six jours sur sept — voir `mentionHorizonNul` pour le septième.
  const horizonNul = mentionHorizonNul(prevision.horizonJours);

  const lignesFacteurs: LigneFacteur[] = [
    {
      cle: 'base',
      libelle: 'Base historique',
      valeur: `${baseline.baselineCrepes} crêpes`,
      neutre: false,
    },
    {
      cle: 'meteo',
      libelle: meteo.disponible ? `Météo — ${meteo.explication}` : 'Météo — indisponible',
      valeur: formaterFacteur(facteurs.meteoBp),
      neutre: facteurs.meteoBp === BASE_POINTS,
    },
    {
      cle: 'evenement',
      // Distingue prior et mesuré, événement par événement (docs/17 fiches
      // 2/4, D-059), ET isole désormais l'impact INDIVIDUEL de chaque
      // événement (docs/21 §2.10) : `facteurs.evenementBp` reste le facteur
      // COMBINÉ affiché en valeur, mais quand plusieurs événements coïncident
      // le même jour, sa contribution respective n'était sinon jamais isolée
      // — voir `libelleEvenementsPrevision`.
      libelle: libelleEvenementsPrevision(evenements),
      valeur: formaterFacteur(facteurs.evenementBp),
      neutre: facteurs.evenementBp === BASE_POINTS,
    },
    {
      // docs/17 fiche 3 : le libellé vient TOUJOURS de `saisonExplication`,
      // jamais d'un texte figé — il distingue « non modélisée » (démarrage à
      // froid), « mesurée sur N sessions/mois » (admise) et « rejetée par
      // validation croisée » (mesurée, mais n'améliore pas le MAPE). Un
      // « × 1,00 » sans cette phrase se lirait « évalué et jugé neutre »,
      // exactement le défaut que D-059 a déjà corrigé pour la météo.
      cle: 'saison',
      libelle: `Saison — ${facteurs.saisonExplication}`,
      valeur: formaterFacteur(facteurs.saisonBp),
      neutre: facteurs.saisonBp === BASE_POINTS,
    },
    {
      cle: 'tendance',
      libelle: `Tendance — ${facteurs.tendanceExplication}`,
      valeur: formaterFacteur(facteurs.tendanceBp),
      neutre: facteurs.tendanceBp === BASE_POINTS,
    },
    /*
     * Cinq prédicteurs de docs/demandes/07 §2 (fiche « historique des ventes
     * et précision »), sur le MÊME patron que les quatre lignes ci-dessus —
     * sauf sur un point volontaire : ceux-ci n'apparaissent QUE si le champ
     * est PRÉSENT dans le contrat. Un champ absent veut dire « non admis »
     * (démarrage à froid ou rejeté par la validation croisée) : la ligne ne
     * doit alors PAS s'afficher, pas s'afficher grisée. Un champ présent mais
     * neutre (10000) s'affiche comme neutre, exactement comme météo ou
     * événement ci-dessus — c'est un facteur qui A ÉTÉ mesuré et jugé fiable,
     * et qui se trouve ne rien changer aujourd'hui.
     */
    ...(facteurs.comparableCalendaireBp !== undefined
      ? [
          {
            cle: 'comparableCalendaire',
            libelle: facteurs.comparableCalendaireExplication ?? 'Comparable calendaire',
            valeur: formaterFacteur(facteurs.comparableCalendaireBp),
            neutre: facteurs.comparableCalendaireBp === BASE_POINTS,
          },
        ]
      : []),
    ...(facteurs.jourSemaineBp !== undefined
      ? [
          {
            cle: 'jourSemaine',
            libelle: facteurs.jourSemaineExplication ?? 'Jour de la semaine',
            valeur: formaterFacteur(facteurs.jourSemaineBp),
            neutre: facteurs.jourSemaineBp === BASE_POINTS,
          },
        ]
      : []),
    ...(facteurs.vacancesScolairesBp !== undefined
      ? [
          {
            cle: 'vacancesScolaires',
            libelle: facteurs.vacancesScolairesExplication ?? 'Vacances scolaires',
            valeur: formaterFacteur(facteurs.vacancesScolairesBp),
            neutre: facteurs.vacancesScolairesBp === BASE_POINTS,
          },
        ]
      : []),
    ...(facteurs.sessionConsecutiveBp !== undefined
      ? [
          {
            cle: 'sessionConsecutive',
            libelle: facteurs.sessionConsecutiveExplication ?? 'Session précédente',
            valeur: formaterFacteur(facteurs.sessionConsecutiveBp),
            neutre: facteurs.sessionConsecutiveBp === BASE_POINTS,
          },
        ]
      : []),
    ...(facteurs.inflationSigmaMeteoBp !== undefined
      ? [
          {
            // Ce facteur n'élargit que l'INTERVALLE P10/P90 (packages/core/
            // src/prevision/ecart-meteo-prevue-realisee.ts) : il n'entre pas
            // dans le produit qui donne la demande attendue, contrairement
            // aux lignes précédentes. Affiché ici quand même, sur le même
            // patron, parce que c'est un facteur mesuré et admis au même
            // titre — la fiche 07 §3 demande qu'il « reste visible dans la
            // décomposition affichée à l'écran ».
            cle: 'inflationSigmaMeteo',
            libelle: facteurs.inflationSigmaMeteoExplication ?? 'Fiabilité météo (intervalle)',
            valeur: formaterFacteur(facteurs.inflationSigmaMeteoBp),
            neutre: facteurs.inflationSigmaMeteoBp === BASE_POINTS,
          },
        ]
      : []),
  ];

  const lignesContraintes: LigneContrainte[] = contraintes.map((c) => ({
    libelle: c.libelle,
    plafondCrepes: c.plafondCrepes,
    limitante: c.libelle === prevision.contrainteLimitante,
  }));

  return (
    <div className="grid grid-cols-1 gap-bloc lg:grid-cols-2">
      <div className="flex flex-col gap-bloc">
        <Panneau
          titre={
            session === null
              ? 'À produire'
              : `À produire — ${session.lieuNom}, ${formaterDate(session.dateSession)}`
          }
        >
          <div className="flex items-baseline gap-3">
            <span className="text-3xl tabular-nums text-ink">{prevision.crepesRetenues}</span>
            <span className="text-sm text-ink-3">crêpes</span>
          </div>

          {prevision.contrainteLimitante !== null && (
            <p className="mt-groupe text-sm text-alerte">
              {'▲'} Ramené de {prevision.crepesRecommandees} à {prevision.crepesRetenues} — limite :{' '}
              {prevision.contrainteLimitante}.
              {prevision.manqueAGagnerCents !== null && (
                <> Manque à gagner estimé : {formaterEuros(prevision.manqueAGagnerCents)}.</>
              )}
            </p>
          )}

          <div className="mt-bloc border-t border-line pt-bloc">
            {/* Les DEUX montants passent par `ouTiret` sur leur propre drapeau
                de connaissance. `coutRuptureCents` vaut `max(0, prix −
                matière)` : une matière inconnue comptée pour 0 le gonfle
                d'autant, il n'est donc un vrai chiffre que si les DEUX termes
                le sont — d'où la conjonction, et non `prixMoyenConnu` seul. */}
            <p className="text-sm text-ink-2">
              Une rupture coûte{' '}
              {ouTiret(
                couts.coutInvenduConnu && couts.prixMoyenConnu ? couts.coutRuptureCents : null,
                formaterEuros,
              )}{' '}
              de marge, un invendu{' '}
              {ouTiret(couts.coutInvenduConnu ? couts.coutInvenduCents : null, formaterEuros)} de
              pâte.{' '}
              {/* Le « donc » ne tient QUE si les deux coûts sont connus : il
                  affirme que le quantile cible découle de leur écart. Sans
                  eux, la phrase reste vraie (le quantile est bien celui-là)
                  mais cesse de se présenter comme sa conséquence. */}
              {avertissementCouts === null ? 'On produit donc au niveau' : 'On produit au niveau'}
              {' qui couvre '}
              {formaterPourcent(prevision.quantileCibleBp)} des cas,{' '}
              <strong className="text-ink">pas 50 %</strong>.
            </p>
            {avertissementCouts !== null && (
              // Registre d'alerte MÉTIER : il y a un geste à faire (renseigner
              // une recette ou un prix), ce n'est pas une panne technique.
              <p className="mt-groupe text-sm text-alerte">
                <span aria-hidden="true">{'▲'}</span> {avertissementCouts}
              </p>
            )}
            <p className="mt-groupe text-xs text-ink-3">{couts.origine}</p>
          </div>

          <dl className="mt-bloc grid grid-cols-3 gap-groupe border-t border-line pt-bloc text-sm">
            <div>
              <dt className="text-2xs uppercase text-ink-3">Fourchette basse</dt>
              <dd className="tabular-nums text-ink-2">{prevision.p10}</dd>
            </div>
            <div>
              <dt className="text-2xs uppercase text-ink-3">Demande médiane</dt>
              <dd className="tabular-nums text-ink-2">{prevision.p50}</dd>
            </div>
            <div>
              <dt className="text-2xs uppercase text-ink-3">Fourchette haute</dt>
              <dd className="tabular-nums text-ink-2">{prevision.p90}</dd>
            </div>
          </dl>

          {/* Posée SOUS les trois nombres qu'elle qualifie, pas dans « D'où
              vient ce chiffre » : c'est l'intervalle lui-même qui a changé de
              nature, et c'est sur lui que se prend la décision de production.
              Registre du FAIT (`text-ink-3`, comme `couts.origine` et
              `baseline.explication`) : ni le `▲` et le `text-alerte` de
              l'alerte métier, ni un `role="alert"` — voir `mentionHorizonNul`. */}
          {horizonNul !== null && <p className="mt-groupe text-xs text-ink-3">{horizonNul}</p>}

          <ExplicationPrevision lignes={prevision.explication} />
        </Panneau>

        <Panneau titre="Plan de production">
          {prevision.repartition.length > 0 ? (
            <>
              <ul className="flex flex-col gap-groupe text-sm">
                {prevision.repartition.map((ligne) => (
                  <li
                    key={ligne.recetteId}
                    className="flex items-baseline justify-between gap-groupe border-b border-line pb-groupe last:border-0 last:pb-0"
                  >
                    <span className="text-ink-2">
                      {ligne.code}
                      {ligne.sansGluten ? ' (sans gluten)' : ''} — {formaterPourcent(ligne.partBp)}
                    </span>
                    <span className="shrink-0 tabular-nums text-ink">
                      {ligne.crepes} crêpes ≈ {(ligne.volumeMl / 1000).toFixed(1).replace('.', ',')}{' '}
                      L
                    </span>
                  </li>
                ))}
              </ul>
              {prevision.plancherSansGlutenApplique && (
                <p className="mt-groupe text-xs text-ink-3">
                  Plancher de sécurité sans gluten appliqué : la part mesurée était en dessous du
                  seuil réglé dans Paramètres, elle a été relevée d’office.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-3">
              {prevision.repartitionRecettesIndisponible
                ? 'Plusieurs recettes actives coexistent sans historique de production pour les départager : la répartition ne peut pas être mesurée pour l’instant.'
                : /*
                   * Défaut trouvé en vérification contre la base réelle (17 lots,
                   * stock de sucre vanillé épuisé) : `repartition` est vide dès que
                   * `crepesRetenues` vaut 0 (écrêtage total par une contrainte,
                   * voir `repartitionProduction` dans packages/core), même quand la
                   * recette active a un rendement parfaitement renseigné. Le
                   * message accusait alors une recette mal remplie alors que la
                   * vraie cause — 0 crêpe retenue — est déjà affichée juste
                   * au-dessus, dans le panneau « À produire ». Ne jamais blâmer le
                   * rendement quand il n'y a simplement rien à répartir.
                   */
                  prevision.crepesRetenues <= 0
                  ? `Aucune crêpe retenue pour l’instant${
                      prevision.contrainteLimitante !== null
                        ? ` (limite : ${prevision.contrainteLimitante})`
                        : ''
                    } : pas de plan de production tant que la quantité à produire est nulle.`
                  : 'Aucune recette active exploitable : renseignez le rendement d’au moins une recette active pour obtenir un plan de production.'}
            </p>
          )}
        </Panneau>

        <Panneau titre="Confiance du modèle">
          <p className="text-sm text-ink-2">
            {formaterPourcent(prevision.confianceBp)} — fondée sur {prevision.nbSessionsComparables}{' '}
            session
            {prevision.nbSessionsComparables > 1 ? 's' : ''} comparable
            {prevision.nbSessionsComparables > 1 ? 's' : ''}.
          </p>
          <p className="mt-groupe text-xs text-ink-3">{baseline.explication}</p>
        </Panneau>
      </div>

      <div className="flex flex-col gap-bloc">
        <Panneau titre="D’où vient ce chiffre" sansRembourrage>
          <Tableau
            colonnes={COLONNES_FACTEURS}
            lignes={lignesFacteurs}
            cleLigne={(l) => l.cle}
            etatVide={<EtatVide variante="normal" texte="Aucun facteur." />}
          />
        </Panneau>

        <Panneau titre="Météo">
          {meteo.disponible ? (
            <div className="text-sm text-ink-2">
              <p>
                {meteo.conditions.temperatureC} °C, {meteo.conditions.precipitationsMm} mm, vent{' '}
                {meteo.conditions.ventKmh} km/h, couverture{' '}
                {formaterPourcent(meteo.conditions.couvertureNuageuseBp)}.
              </p>
              {meteo.ventFort && (
                <p className="mt-groupe text-alerte">
                  {'▲'} Vent fort annoncé : prévoyez le lestage du stand.
                </p>
              )}
              <p className="mt-groupe text-xs text-ink-3">
                Relevé du {formaterDate(meteo.recupereLe)}.
              </p>
            </div>
          ) : (
            /* Mode degrade : l'application reste utilisable sans meteo, et elle le dit. */
            <div className="text-sm text-ink-2">
              <p className="text-alerte">{'▲'} Météo indisponible.</p>
              <p className="mt-groupe text-xs text-ink-3">
                {meteo.raison} Facteur neutre appliqué — la prévision reste valable, elle est
                simplement moins précise.
              </p>
            </div>
          )}
        </Panneau>

        <Panneau titre="Ce qui vous limite" sansRembourrage>
          <Tableau
            colonnes={COLONNES_CONTRAINTES}
            lignes={lignesContraintes}
            cleLigne={(l) => l.libelle}
            etatVide={<EtatVide variante="normal" texte="Aucune contrainte ne s’applique." />}
          />
        </Panneau>

        {/* Croisement avec l'écran Concurrents (docs/demandes/10) : voir le
            commentaire d'en-tête de `PanneauPrixConcurrents` ci-dessus pour le
            choix « déplié en un clic » plutôt qu'affiché en permanence. Rendu
            SEULEMENT si une session est identifiée : sans elle il n'y a aucun
            lieu vers lequel filtrer honnêtement le comparateur. */}
        {session !== null && <PanneauPrixConcurrents session={session} />}
      </div>
    </div>
  );
}
