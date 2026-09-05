import { describe, expect, it } from 'vitest';
import type { Fournisseur } from '@batte/core';
import {
  erreursSaisieFournisseur,
  libelleType,
  statutFournisseur,
  type Brouillon,
} from './Fournisseurs';

/**
 * Retour de focus après un échec d'enregistrement (recette clavier du
 * 30/07/2026, même mission que Produits.tsx et Concurrents.tsx) :
 * `corpsDepuisBrouillon` posait déjà `champsEnErreur` sur un délai ou un
 * montant illisible, mais n'appelait jamais `focaliserPremierChampFautif` —
 * le focus restait sur le bouton « Enregistrer ».
 *
 * `erreursSaisieFournisseur` est la fonction PURE extraite de cette
 * validation locale : ces tests prouvent qu'elle désigne le bon champ EN
 * PREMIER — celui que `corpsDepuisBrouillon` transmet désormais à
 * `focaliserPremierChampFautif` juste après `setChampsEnErreur`.
 */
const BROUILLON_VALIDE: Brouillon = {
  nom: 'Moulin de la Meuse',
  type: 'moulin',
  email: 'contact@moulin-meuse.example',
  telephone: '04 00 00 00 00',
  adresse: 'Rue du Moulin 1, Liège',
  delaiLivraisonJours: '3',
  francoDePort: '150,00',
  commandeMinimum: '50,00',
  notes: '',
};

describe('erreursSaisieFournisseur — le champ que le focus doit atteindre en premier', () => {
  it('signale un délai de livraison illisible sous `delaiLivraisonJours`', () => {
    const erreurs = erreursSaisieFournisseur({ ...BROUILLON_VALIDE, delaiLivraisonJours: 'abc' });
    expect(Object.keys(erreurs)[0]).toBe('delaiLivraisonJours');
  });

  it('accepte 0 comme délai de livraison (livraison immédiate), sans erreur', () => {
    expect(erreursSaisieFournisseur({ ...BROUILLON_VALIDE, delaiLivraisonJours: '0' })).toEqual({});
  });

  it('signale un franco de port illisible sous `francoDePortCents`', () => {
    const erreurs = erreursSaisieFournisseur({ ...BROUILLON_VALIDE, francoDePort: 'abc' });
    expect(Object.keys(erreurs)[0]).toBe('francoDePortCents');
  });

  it('un franco de port VIDE n’est pas une erreur — c’est un montant facultatif absent', () => {
    expect(erreursSaisieFournisseur({ ...BROUILLON_VALIDE, francoDePort: '' })).toEqual({});
  });

  it('signale une commande minimum illisible sous `commandeMinimumCents`', () => {
    const erreurs = erreursSaisieFournisseur({ ...BROUILLON_VALIDE, commandeMinimum: 'abc' });
    expect(Object.keys(erreurs)[0]).toBe('commandeMinimumCents');
  });

  it('ne signale rien pour un brouillon valide', () => {
    expect(erreursSaisieFournisseur(BROUILLON_VALIDE)).toEqual({});
  });
});

/**
 * Recette au navigateur du 31/07/2026 (docs/25-RECETTE-APRES-CAMPAGNE.md
 * §3.2/§4.1) : le fournisseur SYSTÈME « Inventaire d'ouverture » — une
 * contrepartie interne, jamais une vraie entreprise (`packages/db/src/seed/
 * fournisseurs-systeme.ts`) — affichait `▲ Sans e-mail` en colonne Commande,
 * un avertissement qui ne pourra JAMAIS être résolu : on ne lui commandera
 * jamais rien (`conditionnementReference`,
 * `packages/db/src/services/commandes.ts`, l'écarte déjà du moteur de
 * réapprovisionnement). docs/07 §3.5 interdit justement toute
 * alerte non actionnable.
 *
 * Fabrique un `Fournisseur` complet : le contrat `schemaFournisseur`
 * (`packages/core/src/contrats/referentiel.ts`) exige tous ces champs, un
 * objet partiel romprait le typage que `exactOptionalPropertyTypes: true`
 * impose sur tout le dépôt.
 */
function fournisseur(champs: Partial<Fournisseur> = {}): Fournisseur {
  return {
    id: 'f-test',
    nom: 'Moulin de la Meuse',
    type: 'moulin',
    email: 'contact@moulin-meuse.example',
    telephone: null,
    adresse: null,
    delaiLivraisonJours: 3,
    francoDePortCents: null,
    commandeMinimumCents: null,
    notes: null,
    actif: true,
    nbConditionnements: 0,
    ...champs,
  };
}

describe('statutFournisseur — le garde-fou « Sans e-mail »', () => {
  it('CRIE toujours ▲ Sans e-mail pour un fournisseur COMMERCIAL actif sans adresse — le garde-fou reste armé, pas désarmé', () => {
    for (const type of ['moulin', 'grossiste', 'ferme', 'detail'] as const) {
      const statut = statutFournisseur(fournisseur({ type, email: null, actif: true }));
      expect(statut).toEqual({ texte: '▲ Sans e-mail', classe: 'text-alerte' });
    }
  });

  it('ne dit JAMAIS « Sans e-mail » pour le fournisseur SYSTÈME, même sans adresse — le faux avertissement permanent est corrigé', () => {
    const statut = statutFournisseur(fournisseur({ type: 'systeme', email: null, actif: true }));
    expect(statut.texte).not.toMatch(/sans e-mail/i);
    expect(statut.texte).not.toContain('▲');
    expect(statut).toEqual({ texte: 'Non commercial', classe: 'text-ink-3' });
  });

  it('le fournisseur SYSTÈME reste neutre même si (hypothèse défensive) il portait une adresse', () => {
    // `changerActiviteFournisseur`/`modifierFournisseur` refusent déjà toute
    // écriture sur ce fournisseur (`packages/db/src/depots/referentiel.ts:142-
    // 168`) : cette branche ne devrait jamais être atteinte en usage réel.
    // Le test couvre quand même le cas pour prouver que le libellé « Non
    // commercial » dépend du TYPE, jamais d'un hasard sur l'e-mail.
    const statut = statutFournisseur(
      fournisseur({ type: 'systeme', email: 'jamais@reel.example', actif: true }),
    );
    expect(statut).toEqual({ texte: 'Non commercial', classe: 'text-ink-3' });
  });

  it('un fournisseur commercial actif avec adresse reste conforme (● Par mail)', () => {
    const statut = statutFournisseur(
      fournisseur({ type: 'ferme', email: 'contact@ferme.example', actif: true }),
    );
    expect(statut).toEqual({ texte: '● Par mail', classe: 'text-conforme' });
  });

  it('un fournisseur commercial désactivé affiche Inactif, quel que soit l’e-mail', () => {
    const statut = statutFournisseur(fournisseur({ type: 'detail', email: null, actif: false }));
    expect(statut).toEqual({ texte: 'Inactif', classe: 'text-ink-3' });
  });
});

describe('libelleType — le fournisseur système ne s’affiche plus en minuscule brute', () => {
  it('affiche « Système » pour le type systeme, jamais la valeur brute de l’enum', () => {
    expect(libelleType('systeme')).toBe('Système');
  });

  it('les quatre types commerciaux gardent leur libellé capitalisé inchangé', () => {
    expect(libelleType('moulin')).toBe('Moulin');
    expect(libelleType('grossiste')).toBe('Grossiste');
    expect(libelleType('ferme')).toBe('Ferme');
    expect(libelleType('detail')).toBe('Détail');
  });
});

/**
 * `fournisseursProposables` a été DÉPLACÉE vers `packages/core/src/fournisseurs.ts`
 * (mission « garde-fou fournisseur système : de l'écran au service, puis son
 * vrai foyer », 31/07/2026) : c'est une règle de DOMAINE, pas une règle
 * d'écran. Ses tests vivent désormais dans
 * `packages/core/src/fournisseurs.test.ts`, à côté d'elle.
 */
