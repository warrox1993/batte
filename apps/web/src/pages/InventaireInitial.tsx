import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  avertissementsReceptionAAfficher,
  formaterEuros,
  GLYPHE_STATUT,
  mentionCommandeSoldee,
} from '@batte/core';
import { BandeauAlerte, BandeauSucces, CLASSE_BOUTON_SECONDAIRE } from '../saisie-stock/champs';
import { SaisieReception, type ReceptionEnregistree } from '../saisie-stock/SaisieReception';

/**
 * Inventaire d'ouverture : declarer ce qu'on a deja en stock le jour de
 * l'installation.
 *
 * CE N'EST PAS UN MECANISME PARALLELE, et c'est le point important. Un
 * inventaire d'entree cree exactement ce que cree une reception : un lot par
 * article (fournisseur, date, numero de lot, DLC) et un mouvement d'entree par
 * lot. Lui donner sa propre voie d'ecriture ferait une SECONDE porte d'entree
 * dans le stock — donc une seconde occasion de le desynchroniser, et deux
 * codes a maintenir pour la meme obligation de tracabilite (CLAUDE.md §3
 * regle 6). L'ecran reutilise donc `SaisieReception`, telle quelle, avec une
 * autre intention affichee.
 *
 * LIMITE CONNUE, VOLONTAIREMENT NON CONTOURNEE ICI. `POST /api/receptions`
 * exige un `fournisseurId` (`schemaCreationReception`), et le service leve
 * `ErreurIntrouvable('Fournisseur', …)` si l'identifiant ne correspond a rien
 * (`packages/db/src/services/reception.ts`). Il n'existe ni fournisseur
 * nullable, ni fournisseur « inventaire d'ouverture » pre-seme. L'ecran
 * demande donc un fournisseur reel, et le texte ci-dessous dit comment s'en
 * sortir proprement. Contourner cela demanderait de toucher au schema ou aux
 * routes, dont cet ecran n'est pas proprietaire.
 */
export default function InventaireInitial() {
  const navigate = useNavigate();
  const [confirmation, setConfirmation] = useState<string | null>(null);
  /**
   * Avertissements de traçabilité du DERNIER inventaire saisi (docs/21 §1.4,
   * même champ que pour une réception : `SaisieReception` sert les deux) —
   * un lot identifié par sa seule DLC, sans numéro de lot fournisseur.
   * Affichés TELS QUELS (voir `avertissementsReceptionAAfficher`,
   * `@batte/core`), jamais reformulés. `null` sur un inventaire qui n'en
   * produit aucun — le cas le plus fréquent.
   */
  const [avertissements, setAvertissements] = useState<readonly string[] | null>(null);
  /**
   * Change apres chaque enregistrement pour REMONTER le formulaire, donc le
   * vider. Sans cela, les lignes deja ecrites restaient a l'ecran et un second
   * clic sur « Enregistrer » creait une reception en double — un doublon de
   * stock ne se voit pas, il se decouvre trois semaines plus tard sur un ecart
   * d'inventaire.
   */
  const [numeroSaisie, setNumeroSaisie] = useState(0);

  function enregistre(resultat: ReceptionEnregistree): void {
    // Un inventaire d'ouverture peut, en théorie, solder une commande restée
    // ouverte (le formulaire réutilisé le permet) : même mention que pour une
    // réception (« voir laquelle », mission « boucle d'achat », 30/07/2026).
    const commande = mentionCommandeSoldee(resultat.commandeNumero);
    setConfirmation(
      `Inventaire ${resultat.numero} enregistré — ${resultat.nbLots} lot${
        resultat.nbLots > 1 ? 's' : ''
      } créé${resultat.nbLots > 1 ? 's' : ''}, ${formaterEuros(resultat.montantTotalCents)}.${
        commande === null ? '' : ` ${commande}`
      }`,
    );
    setAvertissements(avertissementsReceptionAAfficher(resultat.avertissements));
    setNumeroSaisie((precedent) => precedent + 1);
  }

  return (
    <div className="flex flex-col gap-bloc">
      <div className="flex h-rangee items-center justify-between">
        <h1 className="text-lg text-ink">Inventaire initial</h1>
        <button
          type="button"
          onClick={() => navigate('/stock')}
          className={CLASSE_BOUTON_SECONDAIRE}
        >
          Retour au stock
        </button>
      </div>

      {confirmation !== null && (
        <BandeauSucces>
          {confirmation} Les lots sont visibles dans l’écran Stock ; vous pouvez enchaîner un second
          inventaire ci-dessous.
        </BandeauSucces>
      )}

      {/* Avertissement de traçabilité du dernier inventaire saisi (docs/21
          §1.4). Affiché TEL QUEL, une phrase par lot concerné, jamais
          reformulé. `null` (donc rien à l'écran) le cas le plus fréquent. */}
      {avertissements !== null && (
        <BandeauAlerte>
          {avertissements.map((avertissement, index) => (
            <p key={index} className={index > 0 ? 'mt-groupe' : undefined}>
              <span aria-hidden="true">{GLYPHE_STATUT.alerte}</span> {avertissement}
            </p>
          ))}
        </BandeauAlerte>
      )}

      <p className="max-w-[80ch] text-sm text-ink-2">
        Comptez ce que vous avez déjà en stock et saisissez-le ici, un article par ligne. Chaque
        ligne crée un lot et un mouvement d’entrée, exactement comme une livraison : c’est ce qui
        rend le stock traçable dès le premier jour. Le prix à indiquer est la valeur d’achat de ce
        que vous détenez — c’est elle qui alimentera le coût matière de vos premières crêpes.
      </p>

      <p className="max-w-[80ch] text-xs text-ink-3">
        Un lot porte toujours l’identité de celui qui l’a livré : il faut donc choisir un
        fournisseur. Pour de la marchandise dont l’origine n’est plus documentée, créez une fois
        pour toutes un fournisseur nommé « Inventaire d’ouverture » dans l’écran Fournisseurs, et
        rattachez-lui ces lignes.
      </p>

      <SaisieReception
        key={numeroSaisie}
        variante="inventaire"
        onEnregistre={enregistre}
        onAnnuler={() => navigate('/stock')}
      />
    </div>
  );
}
