/**
 * Routes de stock, receptions et mouvements (Lot 2).
 *
 * L'API assemble et valide ; toute la logique (FEFO, CUMP, valorisation) vient
 * de `@batte/core` et des services de `@batte/db`, en code teste.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  CATALOGUE_MOTIFS,
  definitionMotif,
  ErreurIntrouvable,
  ErreurMetier,
  jourCivilBelge,
  schemaAnnulationReception,
  schemaAnnulationReceptionCreee,
  schemaChangementStatutLot,
  schemaContrepassation,
  schemaContrepassationCreee,
  schemaCreationReception,
  schemaCreationSortie,
  schemaDiagnosticIntegriteStock,
  schemaEtatStock,
  schemaListeLots,
  schemaListeMotifs,
  schemaListeMouvementsLot,
  schemaReceptionCreee,
  schemaSortieCreee,
  schemaStatutLotChange,
  statutStock,
  type CodeMotif,
} from '@batte/core';
import {
  annulerMouvement,
  annulerReception,
  changerStatutLot,
  diagnostiquerIntegriteStock,
  enregistrerReception,
  enregistrerSortie,
  etatDuStock,
  lotsDeLIngredient,
  mouvementsDuLot,
  schema,
  type BaseBatte,
} from '@batte/db';

/**
 * Pièce jointe d'une réception (bon de livraison scanné), lue à part du contrat
 * partagé qui ne la porte pas encore — voir le commentaire au point d'usage.
 */
const schemaPieceJointeReception = z.object({
  fichierScanPath: z.string().nullable().optional(),
});

/**
 * Resout un code motif contre le catalogue AVANT d'entrer en base.
 *
 * On rend `definition.code` et non la chaine saisie : c'est ce qui affine le
 * type sans transtypage, et un motif inconnu devient une erreur de SAISIE a 422
 * (D-035) plutot qu'une erreur interne au fond du service.
 */
function resoudreCodeMotif(brut: string): CodeMotif {
  // `definitionMotif` et non un `find` local : la recherche dans le catalogue
  // est une règle de `packages/core` (CLAUDE.md §3 règle 1), et la réécrire ici
  // en faisait une duplication que `docs/13` §5.4 avait relevée.
  const definition = definitionMotif(brut);
  if (definition === undefined) {
    throw new ErreurMetier('motif_inconnu', `Le motif « ${brut} » n'existe pas.`, {
      champs: { motifCode: 'Choisissez un motif dans la liste.' },
    });
  }
  return definition.code;
}

/** Libelles des quatre statuts de lot, pour des messages d'erreur lisibles. */
const LIBELLE_STATUT_LOT: Readonly<
  Record<'disponible' | 'quarantaine' | 'bloque' | 'detruit', string>
> = {
  disponible: 'disponible',
  quarantaine: 'en quarantaine',
  bloque: 'bloqué',
  detruit: 'détruit',
};

export function routesStock(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    /**
     * Etat du stock. Le jour de reference est le jour civil BELGE et non le
     * jour UTC : une DLC se juge au calendrier local (CLAUDE.md §8).
     */
    app.get('/stock', async () => {
      const jour = jourCivilBelge(new Date());
      const lignes = etatDuStock(base, jour);

      return schemaEtatStock.parse({
        data: lignes,
        meta: {
          total: lignes.length,
          valeurTotaleCents: lignes.reduce((somme, l) => somme + l.valeurCents, 0),
          // Compte via `statutStock`, la MEME fonction que l'ecran utilise pour
          // colorer chaque ligne. Une definition locale du « sous seuil » ici
          // divergerait de l'affichage : l'en-tete annoncerait « 0 ingredient
          // concerne » au-dessus de sept lignes rouges.
          nbAReapprovisionner: lignes.filter(
            (l) => statutStock(l.quantiteDisponible, l.stockSecurite) !== 'conforme',
          ).length,
        },
      });
    });

    /**
     * DIAGNOSTIC D'INTEGRITE DU STOCK — le controle sur lequel repose la
     * credibilite du registre AFSCA.
     *
     * `verifierInvariantLots` (packages/db/src/depots/stock.ts) existait,
     * testee a trois reprises, et n'etait appelee par AUCUN chemin de
     * production (`docs/13-AUDIT-CAPACITES-ORPHELINES.md`,
     * `packages/db/src/audit-silences.test.ts`) : une regression du grand
     * livre de stock serait passee inapercue jusqu'au jour d'un controle reel.
     *
     * Route DE DIAGNOSTIC, declenchee A LA DEMANDE de l'utilisateur, et non
     * en effet de bord d'une sauvegarde : `sauvegarder()`
     * (packages/core/src/sauvegarde.ts) tourne aussi sur des bases de test
     * SANS le schema complet (`baseEnMemoire()` de `sauvegarde.test.ts`, qui
     * ne cree que la table `marqueur`) — y brancher l'appel y leverait
     * « no such table: lot ».
     *
     * Le contrat rend TOUJOURS un verdict explicite, jamais seulement le
     * detail d'un defaut : « cohérent, N lots vérifiés » est une reponse a
     * part entiere (CLAUDE.md §4 — un silence rassurant est un echec
     * silencieux).
     */
    app.get('/stock/integrite', async () =>
      schemaDiagnosticIntegriteStock.parse(diagnostiquerIntegriteStock(base)),
    );

    app.get<{ Params: { ingredientId: string } }>('/stock/:ingredientId/lots', async (requete) => {
      const lots = lotsDeLIngredient(base, requete.params.ingredientId);
      if (lots.length === 0) {
        // Un ingredient sans aucun lot n'est pas une erreur : c'est un stock
        // jamais approvisionne. On rend une liste vide, l'ecran l'explique.
        return schemaListeLots.parse({ data: [], meta: { total: 0 } });
      }

      /**
       * DEFAUT CORRIGE (audit du 31/07/2026, D-083) : ce filtre masquait TOUT
       * lot a `quantiteRestante === 0` et `statut === 'disponible'` — sans
       * distinguer un lot simplement EPUISE PAR LA VENTE NORMALE (le cas
       * frequent que ce filtre existe pour ne pas noyer l'ecran, docs/06 §4)
       * d'un lot dont la RECEPTION a ete ANNULEE (`annulerReception`,
       * `packages/db/src/services/reception.ts`) : contrepasser une reception
       * ramene mecaniquement sa quantite restante a zero sans jamais toucher
       * `lot.statut`, qui reste `disponible`. Le lot — et avec lui tout son
       * historique de mouvements, seule preuve que la contrepassation a bien
       * eu lieu — disparaissait donc de cet ecran des l'instant meme ou la
       * correction reussissait. C'est exactement ce que D-083 interdit
       * (« l'ecriture d'annulation et l'ecriture annulee restent toutes les
       * deux visibles, jamais l'une a la place de l'autre ») et ce que §3
       * regle 7 nomme : un lot rendu introuvable est efface du point de vue
       * de qui le cherche, meme si la ligne survit en base.
       *
       * `l.receptionStatut === 'annulee'` (deja porte par `LotEnBase`,
       * `packages/db/src/depots/stock.ts`, precisement pour cette
       * distinction — voir son commentaire) garde donc CE lot visible SANS
       * rouvrir la porte aux lots simplement vides : un lot vide par la vente
       * a `receptionStatut === 'active'`, les deux autres branches du OU
       * restant fausses pour lui, il reste filtre exactement comme avant.
       */
      const data = lots
        .filter(
          (l) =>
            l.quantiteRestante > 0 || l.statut !== 'disponible' || l.receptionStatut === 'annulee',
        )
        .map((l) => ({
          id: l.id,
          numeroLotFournisseur: l.numeroLotFournisseur,
          dateReception: l.dateReception,
          dateDlc: l.dateDlc,
          quantiteRestante: l.quantiteRestante,
          quantiteInitiale: l.quantiteInitiale,
          // Le montant paye ET le taux : l'ecran affiche le premier (c'est
          // ce qui figure sur la facture), les calculs utilisent le second.
          prixLigneCents: l.prixLigneCents,
          prixUnitaireCents: l.prixUnitaireCents,
          statut: l.statut,
          // Statut de la RÉCEPTION d'origine (D-038 appliqué à la réception,
          // 30/07/2026) : c'est ce qui permet à l'écran de distinguer un lot
          // simplement épuisé d'un lot dont la réception a été annulée.
          receptionStatut: l.receptionStatut,
        }));

      return schemaListeLots.parse({ data, meta: { total: data.length } });
    });

    /** Catalogue des motifs, pour les listes deroulantes de l'interface. */
    app.get('/motifs', async () =>
      schemaListeMotifs.parse({
        data: CATALOGUE_MOTIFS.map((m) => ({
          code: m.code,
          libelle: m.libelle,
          categorie: m.categorie,
        })),
        meta: { total: CATALOGUE_MOTIFS.length },
      }),
    );

    app.post('/receptions', async (requete, reponse) => {
      const corps = schemaCreationReception.parse(requete.body);

      // `schemaCreationReception.dateReception` (packages/core/src/contrats/stock.ts,
      // hors zone d'écriture) n'exige qu'une chaîne non vide, sans validation de
      // format : `enregistrerReception` (packages/db/src/services/reception.ts)
      // en extrait pourtant l'année par `dateReception.slice(0, 4)` puis
      // `Number.parseInt(...)` pour numéroter la réception — une valeur qui n'a
      // pas ce format (« pas-une-date ») y produit `NaN`, qui remontait en 500
      // brut au lieu d'un refus de saisie. Même défaut, même garde-fou que
      // `routes/sessions.ts` pour `dateSession`.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(corps.dateReception)) {
        throw new ErreurMetier(
          'date_reception_invalide',
          `« ${corps.dateReception} » n'est pas une date valide. Indiquez une date au format AAAA-MM-JJ.`,
          {
            champs: {
              dateReception: 'Indiquez une date au format AAAA-MM-JJ, par exemple 2026-08-01.',
            },
          },
        );
      }

      /*
       * Bon de livraison scanné — même patron que `routes/factures.ts`.
       *
       * `schemaCreationReception` (`packages/core/src/contrats/stock.ts`) ne
       * porte pas ce champ, donc son `.parse()` le supprimerait en silence. On
       * relit donc la requête brute pour cette seule clé, plutôt que d'élargir
       * un contrat partagé pour un champ que seule cette route transmet.
       *
       * `enregistrerReception` valide ensuite la pièce elle-même
       * (`validerPieceJointe` : format Data URI, plafond de taille, chaîne vide
       * ramenée à `null`) — la validation reste dans le service, ici on ne fait
       * que ne pas perdre la donnée en chemin.
       */
      const pieceJointe = schemaPieceJointeReception.parse(requete.body);

      const resultat = enregistrerReception(base, {
        fournisseurId: corps.fournisseurId,
        dateReception: corps.dateReception,
        numeroBonLivraison: corps.numeroBonLivraison ?? null,
        commandeId: corps.commandeId ?? null,
        fichierScanPath: pieceJointe.fichierScanPath ?? null,
        notes: corps.notes ?? null,
        lignes: corps.lignes.map((l) => ({
          ingredientId: l.ingredientId,
          quantite: l.quantite,
          prixLigneCents: l.prixLigneCents,
          numeroLotFournisseur: l.numeroLotFournisseur ?? null,
          dateDlc: l.dateDlc ?? null,
        })),
      });

      reponse.code(201);
      return schemaReceptionCreee.parse({
        receptionId: resultat.receptionId,
        numero: resultat.numero,
        montantTotalCents: resultat.montantTotalCents,
        nbLots: resultat.lotsCrees.length,
        avertissements: resultat.avertissements,
        // « Voir laquelle » (mission « boucle d'achat », 30/07/2026) : la
        // confirmation redit désormais quelle commande vient d'être soldée.
        commandeNumero: resultat.commandeNumero,
      });
    });

    /**
     * ANNULER une réception : contrepasse l'entrée de stock de chacun de ses
     * lots, jamais un `DELETE` ni un `UPDATE` de quantité (CLAUDE.md §3
     * règles 5 et 7).
     *
     * Ce chemin n'existait pas, alors que l'annulation d'une production, d'une
     * session et d'une commande existait déjà : une marchandise saisie par
     * erreur restait en stock pour toujours, et la seule issue était une
     * contrepassation manuelle, mouvement par mouvement.
     *
     * `annulerReception` refuse d'elle-même les deux cas dangereux — un lot déjà
     * consommé (sinon le restant deviendrait négatif) et une période verrouillée
     * — et le gestionnaire d'erreurs commun les traduit en 422 avec un message
     * français affichable.
     *
     * `resultat` porte aussi `commandeId`/`commandeStatutRestaure` (mission
     * « boucle d'achat », 30/07/2026) : quand cette réception soldait une
     * commande, le service restaure son statut antérieur s'il a pu être
     * retrouvé avec certitude, ou rend l'incohérence explicite et permanente
     * dans `commande.notes` sinon — voir le commentaire de fonction dans
     * `packages/db/src/services/reception.ts`. Rien à assembler ici : le
     * service rend déjà exactement la forme du contrat.
     */
    app.post<{ Params: { id: string } }>('/receptions/:id/annuler', async (requete, reponse) => {
      const corps = schemaAnnulationReception.parse(requete.body);
      const resultat = annulerReception(
        base,
        requete.params.id,
        resoudreCodeMotif(corps.motifCode),
      );

      reponse.code(201);
      return schemaAnnulationReceptionCreee.parse(resultat);
    });

    app.post('/mouvements', async (requete, reponse) => {
      const corps = schemaCreationSortie.parse(requete.body);

      const resultat = enregistrerSortie(base, {
        ingredientId: corps.ingredientId,
        quantite: corps.quantite,
        type: corps.type,
        motifCode: resoudreCodeMotif(corps.motifCode),
        motifTexte: corps.motifTexte ?? null,
        dateMouvement: corps.dateMouvement,
        autoriserDlcDepassee: corps.autoriserDlcDepassee ?? false,
      });

      reponse.code(201);
      return schemaSortieCreee.parse({
        nbMouvements: resultat.mouvements.length,
        coutTotalCents: resultat.coutTotalCents,
      });
    });

    /** Tracabilite amont : de quel lot vient cet ingredient, et d'ou. */
    app.get<{ Params: { lotId: string } }>('/lots/:lotId', async (requete) => {
      const tous = etatDuStock(base, jourCivilBelge(new Date()));
      for (const ligne of tous) {
        const trouve = lotsDeLIngredient(base, ligne.ingredientId).find(
          (l) => l.id === requete.params.lotId,
        );
        if (trouve !== undefined) return trouve;
      }
      throw new ErreurIntrouvable('Lot', requete.params.lotId);
    });

    /**
     * HISTORIQUE DES MOUVEMENTS D'UN LOT.
     *
     * C'est la piece qui manquait pour rendre la contrepassation ATTEIGNABLE :
     * on ne corrige pas une erreur qu'on ne voit pas. `docs/13` §2.2 relevait
     * qu'aucune route ne rendait un historique de mouvements — l'ecran Stock ne
     * pouvait montrer que l'etat et les lots.
     *
     * Les mouvements ANNULES sont rendus, jamais filtres (D-021) : ils restent
     * au journal et l'ecran les barre. C'est la seule lecture juste, et c'est
     * aussi ce que l'AFSCA demande — un historique auditable.
     *
     * Le catalogue de motifs est charge en un seul aller-retour et indexe par
     * identifiant : un lot porte rarement plus de quelques dizaines de
     * mouvements, le catalogue en compte treize, une jointure par ligne serait
     * du cout pur.
     */
    app.get<{ Params: { lotId: string } }>('/lots/:lotId/mouvements', async (requete) => {
      const { lotId } = requete.params;

      // 404 pour une ressource ADRESSEE DANS L'URL (D-035). Un lot inconnu
      // n'est pas « un lot sans mouvement » : c'est une adresse fausse, et
      // rendre une liste vide laisserait croire a un lot vierge.
      const existe = base
        .select({ id: schema.lot.id })
        .from(schema.lot)
        .where(eq(schema.lot.id, lotId))
        .get();
      if (existe === undefined) throw new ErreurIntrouvable('Lot', lotId);

      const codeParMotifId = new Map(
        base
          .select({ id: schema.motif.id, code: schema.motif.code })
          .from(schema.motif)
          .all()
          .map((m) => [m.id, m.code]),
      );

      const data = mouvementsDuLot(base, lotId).map((m) => {
        const code = m.motifId === null ? null : (codeParMotifId.get(m.motifId) ?? null);
        return {
          id: m.id,
          type: m.type,
          quantite: m.quantite,
          dateMouvement: m.dateMouvement,
          coutCents: m.coutCents,
          motifCode: code,
          motifLibelle: code === null ? null : (definitionMotif(code)?.libelle ?? null),
          motifTexte: m.motifTexte,
          ajustement: m.ajustement,
          isAnnule: m.isAnnule,
          annuleParId: m.annuleParId,
          // Une contrepassation se reconnait a son texte de motif, ecrit par
          // `annulerMouvement`. Le schema n'a pas de colonne dediee et on ne le
          // modifie pas ici : l'ecran a seulement besoin de ne PAS proposer
          // « annuler » sur une ecriture qui EST deja une annulation.
          estContrepassation: m.motifTexte?.startsWith('Contrepassation du mouvement ') ?? false,
          creeLe: m.creeLe,
        };
      });

      return schemaListeMouvementsLot.parse({
        data,
        meta: { total: data.length, nbAnnules: data.filter((m) => m.isAnnule).length },
      });
    });

    /**
     * CONTREPASSATION — le seul chemin de correction d'un mouvement.
     *
     * CLAUDE.md §3 regle 7 : « corrections par ecriture d'annulation, jamais par
     * DELETE ». Sans cette route, une erreur de saisie de stock etait
     * DEFINITIVE : qui tape 250 kg au lieu de 25 kg n'avait aucun recours.
     *
     * Le service ecrit l'ecriture inverse ET marque l'originale annulee, dans la
     * meme transaction, avec une entree au journal d'audit. Il refuse la
     * seconde annulation d'une meme ecriture (D-021) : sans cette regle, deux
     * annulations successives creeraient de la matiere.
     */
    app.post<{ Params: { mouvementId: string } }>(
      '/mouvements/:mouvementId/annuler',
      async (requete, reponse) => {
        const corps = schemaContrepassation.parse(requete.body);
        const { mouvementId } = requete.params;

        // Relu AVANT l'ecriture pour porter la quantite dans la reponse : la
        // confirmation doit dire CE QUI a bouge, pas « c'est fait ».
        const origine = base
          .select({ quantite: schema.mouvementStock.quantite })
          .from(schema.mouvementStock)
          .where(eq(schema.mouvementStock.id, mouvementId))
          .get();
        if (origine === undefined) throw new ErreurIntrouvable('Mouvement', mouvementId);

        const contrepassationId = annulerMouvement(
          base,
          mouvementId,
          resoudreCodeMotif(corps.motifCode),
        );

        reponse.code(201);
        return schemaContrepassationCreee.parse({
          mouvementAnnuleId: mouvementId,
          contrepassationId,
          quantite: origine.quantite,
        });
      },
    );

    /**
     * MISE EN QUARANTAINE, BLOCAGE, DESTRUCTION, REMISE A DISPOSITION.
     *
     * `schema.ts:450` motive le mecanisme : « un ERP BLOQUE et exige un
     * deblocage explicite trace ; c'est aussi une exigence AFSCA : un lot
     * suspecte doit pouvoir etre mis en quarantaine avant decision. » La FEFO ne
     * sert que les lots `disponible`, donc le mecanisme protege reellement — il
     * n'avait simplement aucun declencheur.
     *
     * `PATCH` et non `POST` : on modifie l'etat d'une ressource existante
     * adressee dans l'URL, comme `PATCH /produits/:id/activite`.
     */
    app.patch<{ Params: { lotId: string } }>('/lots/:lotId/statut', async (requete) => {
      const corps = schemaChangementStatutLot.parse(requete.body);
      const { lotId } = requete.params;

      const avant = base
        .select({ statut: schema.lot.statut })
        .from(schema.lot)
        .where(eq(schema.lot.id, lotId))
        .get();
      if (avant === undefined) throw new ErreurIntrouvable('Lot', lotId);

      if (avant.statut === corps.statut) {
        // Le service refuse deja ce cas ; on le refuse ICI pour pouvoir
        // designer le CHAMP fautif (D-035 : 422 + `champs`), ce que le service
        // ne peut pas faire — il ignore tout du formulaire qui l'appelle.
        throw new ErreurMetier(
          'statut_inchange',
          `Ce lot est déjà ${LIBELLE_STATUT_LOT[avant.statut]} : il n'y a rien à changer.`,
          { champs: { statut: 'Choisissez un statut différent de celui du lot.' } },
        );
      }

      // Jour civil BELGE, meme convention que `/stock` ci-dessus : une
      // destruction est datee au calendrier local, pas a l'instant UTC
      // (CLAUDE.md §8). Le service reste pur et testable avec une date
      // explicite ; c'est la route qui possede « maintenant ».
      const resultatDestruction = changerStatutLot(
        base,
        lotId,
        corps.statut,
        resoudreCodeMotif(corps.motifCode),
        jourCivilBelge(new Date()),
      );

      return schemaStatutLotChange.parse({
        lotId,
        statutPrecedent: avant.statut,
        statut: corps.statut,
        mouvementDestructionId: resultatDestruction.mouvementDestructionId,
        quantiteDetruite: resultatDestruction.quantiteDetruite,
        coutDetruitCents: resultatDestruction.coutDetruitCents,
      });
    });
  };
}
