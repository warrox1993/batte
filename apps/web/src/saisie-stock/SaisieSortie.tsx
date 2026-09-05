import { useMemo, useState } from 'react';
import {
  formaterQuantite,
  libelleUnite,
  motifsPour,
  schemaSortieCreee,
  type CategorieMotif,
  type Unite,
} from '@batte/core';
import { requeteApi } from '../lib/api';
import { aujourdHui } from '../lib/dates';
import { MessageErreur } from '../composants/EncartErreur';
import {
  AUCUNE_ERREUR,
  CLASSE_BOUTON_PRIMAIRE,
  CLASSE_BOUTON_SECONDAIRE,
  ChampSaisie,
  ChampSelection,
  parserEntierPositif,
  repartirErreurApi,
  type ErreursFormulaire,
  type OptionSelection,
} from './champs';

/**
 * Sortie de stock de CORRECTION : la matière qui part sans passer par une
 * production ni par une vente — casse, don, consommation personnelle, écart
 * d'inventaire.
 *
 * REGLE N°5, NON NEGOCIABLE (CLAUDE.md §3) : le stock ne se modifie QUE par un
 * mouvement. Cet écran n'écrit donc jamais une quantité : il poste un
 * mouvement sur `POST /api/mouvements`, et le stock courant reste la somme des
 * mouvements. C'est ce qui le rend auditable — exactement ce que l'AFSCA
 * demande.
 *
 * LE MOTIF EST OBLIGATOIRE ET CHOISI DANS UNE LISTE, jamais tapé à la main.
 * Sans code, on ne peut pas répondre à « où fuit la matière ? » (docs/07 §6.8
 * rang 9), et un écart qu'on ne peut pas attribuer est un écart qu'on ne peut
 * pas corriger. Le serveur refuse déjà un code inconnu (`422 motif_inconnu`) ;
 * l'écran ne lui donne simplement jamais l'occasion. Le texte libre reste
 * disponible EN COMPLÉMENT, jamais en remplacement.
 */

/** Ce que la route rend en 201. Type dérivé du schéma, jamais réécrit (docs/06). */
export type SortieEnregistree = ReturnType<typeof schemaSortieCreee.parse>;

/**
 * Types de sortie proposés ici, et catégorie de motifs associée.
 *
 * `sortie_production` et `sortie_vente` sont VOLONTAIREMENT absents : la
 * première est écrite par l'ordre de production, la seconde par la clôture de
 * session. Les saisir aussi à la main déduirait la matière deux fois — et
 * l'écart théorique/réel, qui est précisément l'indicateur qu'on cherche à
 * lire, deviendrait ininterprétable.
 */
const TYPES_SORTIE = [
  { valeur: 'perte', libelle: 'Perte', categorie: 'perte' },
  { valeur: 'consommation_perso', libelle: 'Sortie volontaire', categorie: 'sortie_volontaire' },
  { valeur: 'ajustement_inventaire', libelle: "Écart d'inventaire", categorie: 'ajustement' },
] as const;

type TypeSortieProposee = (typeof TYPES_SORTIE)[number]['valeur'];

const OPTIONS_TYPE: readonly OptionSelection[] = TYPES_SORTIE.map((t) => ({
  valeur: t.valeur,
  libelle: t.libelle,
}));

function categorieDe(type: TypeSortieProposee): CategorieMotif {
  return TYPES_SORTIE.find((t) => t.valeur === type)?.categorie ?? 'perte';
}

/** Champs que cet écran sait afficher ; le reste repart en bandeau (jamais perdu). */
const CHAMPS_AFFICHES: ReadonlySet<string> = new Set([
  'quantite',
  'motifCode',
  'motifTexte',
  'dateMouvement',
  'type',
]);

function absorberErreurServeur(reparties: ErreursFormulaire): ErreursFormulaire {
  const champs: Record<string, string> = {};
  const orphelins: string[] = [];

  for (const [cle, message] of Object.entries(reparties.champs)) {
    if (CHAMPS_AFFICHES.has(cle)) champs[cle] = message;
    else orphelins.push(message);
  }

  const general = [reparties.general, ...orphelins]
    .filter((message): message is string => message !== null && message !== '')
    .join(' ');

  return { champs, general: general === '' ? null : general };
}

type SaisieSortieProps = {
  ingredientId: string;
  nomIngredient: string;
  unite: Unite;
  quantiteDisponible: number;
  onEnregistre: (resultat: SortieEnregistree) => void;
  onAnnuler: () => void;
};

export function SaisieSortie({
  ingredientId,
  nomIngredient,
  unite,
  quantiteDisponible,
  onEnregistre,
  onAnnuler,
}: SaisieSortieProps) {
  const [type, setType] = useState<TypeSortieProposee>('perte');
  const [motifCode, setMotifCode] = useState('');
  const [quantite, setQuantite] = useState('');
  const [dateMouvement, setDateMouvement] = useState(aujourdHui);
  const [motifTexte, setMotifTexte] = useState('');
  const [autoriserDlcDepassee, setAutoriserDlcDepassee] = useState(false);
  const [erreurs, setErreurs] = useState<ErreursFormulaire>(AUCUNE_ERREUR);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  /**
   * Seuls les motifs de la catégorie du type choisi : ne pas noyer la liste.
   *
   * `motifsPour` (`@batte/core`, règle d'architecture n°1) fait exactement ce
   * filtrage — le réimplémenter ici via un `.filter()` à la main aurait été
   * une seconde vérité pour la même règle métier. `CATALOGUE_MOTIFS` est un
   * module STATIQUE déjà présent côté navigateur (même paquet que
   * `schemaSortieCreee` ci-dessus) : l'appeler ne coûte donc aucun
   * aller-retour réseau, contrairement à l'ancien `GET /motifs` qui ne
   * servait plus qu'à transporter ces mêmes données.
   */
  const optionsMotifs: OptionSelection[] = useMemo(
    () =>
      motifsPour(categorieDe(type)).map((motif) => ({
        valeur: motif.code,
        libelle: motif.libelle,
      })),
    [type],
  );

  const quantiteLue = parserEntierPositif(quantite);

  function nettoyerErreur(champ: string): void {
    setErreurs((precedentes) => {
      if (precedentes.champs[champ] === undefined) return precedentes;
      const champs = { ...precedentes.champs };
      delete champs[champ];
      return { champs, general: precedentes.general };
    });
  }

  function enregistrer(): void {
    if (envoiEnCours) return;

    const champsFautifs: Record<string, string> = {};
    if (motifCode === '') {
      champsFautifs['motifCode'] = 'Choisissez un motif dans la liste.';
    }
    if (quantiteLue === null) {
      champsFautifs['quantite'] =
        `La quantité sortie doit être un nombre entier de ${libelleUnite(unite)}, supérieur à zéro.`;
    }
    if (dateMouvement.trim() === '') {
      champsFautifs['dateMouvement'] = 'Indiquez le jour où la matière est sortie.';
    }

    if (Object.keys(champsFautifs).length > 0) {
      setErreurs({ champs: champsFautifs, general: null });
      return;
    }

    setErreurs(AUCUNE_ERREUR);
    setEnvoiEnCours(true);

    requeteApi<unknown>('/mouvements', {
      method: 'POST',
      body: JSON.stringify({
        ingredientId,
        quantite: quantiteLue,
        type,
        motifCode,
        motifTexte: motifTexte.trim() === '' ? null : motifTexte.trim(),
        dateMouvement,
        autoriserDlcDepassee,
      }),
    })
      .then((reponse) => {
        setEnvoiEnCours(false);
        onEnregistre(schemaSortieCreee.parse(reponse));
      })
      .catch((erreur: unknown) => {
        setEnvoiEnCours(false);
        setErreurs(absorberErreurServeur(repartirErreurApi(erreur)));
      });
  }

  return (
    <form
      className="flex flex-col gap-groupe px-4 py-3"
      onSubmit={(evenement) => {
        evenement.preventDefault();
        enregistrer();
      }}
      onKeyDown={(evenement) => {
        if ((evenement.ctrlKey || evenement.metaKey) && evenement.key === 's') {
          evenement.preventDefault();
          enregistrer();
        }
      }}
    >
      <p className="text-xs text-ink-2">
        Sortie de <span className="font-medium text-ink">{nomIngredient}</span> — disponible{' '}
        <span className="num font-medium text-ink">
          {formaterQuantite(quantiteDisponible, unite)}
        </span>
      </p>

      {/* Quatre champs sur une rangee : le panneau de detail occupe desormais
          toute la largeur, et a 720 px de haut c'est la HAUTEUR qui est la
          ressource rare (docs/07 §4.4). `lg:` (1024 px), jamais `xl:`. */}
      <div className="grid grid-cols-1 gap-groupe lg:grid-cols-4">
        <ChampSelection
          nom="type"
          libelle="Nature de la sortie"
          valeur={type}
          onChange={(valeur) => {
            setType(valeur as TypeSortieProposee);
            // Le motif appartient à une catégorie : changer de nature sans le
            // remettre à zéro laisserait un motif de perte sur un écart
            // d'inventaire, et le serveur ne peut pas le voir.
            setMotifCode('');
            nettoyerErreur('type');
          }}
          options={OPTIONS_TYPE}
          erreur={erreurs.champs['type']}
        />

        <ChampSelection
          nom="motifCode"
          libelle="Motif"
          valeur={motifCode}
          onChange={(valeur) => {
            setMotifCode(valeur);
            nettoyerErreur('motifCode');
          }}
          options={optionsMotifs}
          optionVide="Choisir…"
          obligatoire
          erreur={erreurs.champs['motifCode']}
          aide="Le motif est obligatoire : c'est lui qui répond plus tard à « où fuit la matière ? »."
        />

        <ChampSaisie
          nom="quantite"
          libelle={`Quantité sortie (${libelleUnite(unite)})`}
          numerique="entier"
          valeur={quantite}
          onChange={(valeur) => {
            setQuantite(valeur);
            nettoyerErreur('quantite');
          }}
          erreur={erreurs.champs['quantite']}
          aide={quantiteLue === null ? undefined : formaterQuantite(quantiteLue, unite)}
        />

        <ChampSaisie
          nom="dateMouvement"
          libelle="Date"
          type="date"
          valeur={dateMouvement}
          onChange={(valeur) => {
            setDateMouvement(valeur);
            nettoyerErreur('dateMouvement');
          }}
          erreur={erreurs.champs['dateMouvement']}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-groupe lg:grid-cols-2">
        <ChampSaisie
          nom="motifTexte"
          libelle="Précision (facultatif)"
          valeur={motifTexte}
          onChange={(valeur) => {
            setMotifTexte(valeur);
            nettoyerErreur('motifTexte');
          }}
          erreur={erreurs.champs['motifTexte']}
        />

        {/* Sans cette case, jeter un lot périmé est IMPOSSIBLE : la FEFO écarte
          les lots dépassés, la quantité demandée devient introuvable, et
          l'écran répond « stock insuffisant » alors que la marchandise est là.
          C'est l'invariant n°2 de docs/02 : consommer un lot périmé exige un
          motif explicite — d'où la case, cochée par l'utilisateur, jamais par
          l'application. */}
        <label className="flex items-start gap-groupe pt-5 text-sm text-ink-2">
          <input
            type="checkbox"
            name="autoriserDlcDepassee"
            className="mt-1"
            checked={autoriserDlcDepassee}
            onChange={(evenement) => setAutoriserDlcDepassee(evenement.target.checked)}
          />
          <span>
            Autoriser les lots dont la DLC est dépassée
            <span className="block text-xs text-ink-3">
              À cocher pour enregistrer une marchandise jetée pour DLC dépassée. Le mouvement en
              gardera la trace.
            </span>
          </span>
        </label>
      </div>

      {erreurs.general !== null && <MessageErreur message={erreurs.general} />}

      <div className="flex items-center justify-end gap-groupe border-t border-line pt-3">
        <button type="button" onClick={onAnnuler} className={CLASSE_BOUTON_SECONDAIRE}>
          Annuler
        </button>
        <button type="submit" disabled={envoiEnCours} className={CLASSE_BOUTON_PRIMAIRE}>
          {envoiEnCours ? 'Enregistrement…' : 'Enregistrer la sortie'}
        </button>
      </div>
    </form>
  );
}
