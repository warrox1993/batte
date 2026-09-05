/**
 * Lecture des parametres en vigueur.
 *
 * Une cle peut avoir plusieurs lignes datees ; la resolution « quelle valeur
 * s'applique a telle date » se fait en SQL, pas en TypeScript, pour qu'un
 * recalcul sur un exercice passe reprenne bien les seuils de cette annee-la.
 */

import {
  ErreurIntrouvable,
  ErreurMetier,
  Parametres,
  definitionParametre,
  jourCivilBelge,
  maintenantUtc,
  nouvelIdentifiant,
  type DefinitionParametre,
  type TypeValeurParametre,
} from '@batte/core';
import { and, eq, sql } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { parametre } from '../schema.js';
import { journaliser } from './audit.js';

/**
 * Toutes les valeurs en vigueur a une date donnee (par defaut : aujourd'hui).
 *
 * **Repli sur la version la plus ancienne** quand la date demandee precede
 * toute version d'une cle. Sans ce repli, consulter les tâches de nettoyage en
 * retard « au 15 juin de l'an dernier », ou saisir un relevé de température
 * oublié d'un exercice antérieur, ne ramenait AUCUNE ligne : la premiere
 * lecture typee levait alors `ErreurParametreManquant`, donc une erreur 500
 * disant « Renseignez-le dans Paramètres » — un diagnostic entierement faux,
 * puisque le parametre existe bel et bien.
 *
 * Le repli est defendable : les valeurs du catalogue sont les valeurs
 * initiales de l'activite. Les appliquer a une date anterieure a leur debut
 * nominal reste une approximation, mais une approximation VISIBLE, la ou un
 * 500 ne laissait que l'incomprehension.
 */
export function lireParametres(base: BaseBatte, aLaDate?: string): Parametres {
  const date = aLaDate ?? jourCivilBelge(new Date());

  const enVigueur = base
    .select({ cle: parametre.cle, valeur: parametre.valeur })
    .from(parametre)
    .where(
      and(
        sql`${parametre.dateDebutValidite} <= ${date}`,
        sql`(${parametre.dateFinValidite} IS NULL OR ${parametre.dateFinValidite} >= ${date})`,
      ),
    )
    // La plus recente date de debut gagne ; `Parametres` conserve la derniere
    // valeur vue pour une cle, d'ou le tri ascendant.
    .orderBy(sql`${parametre.dateDebutValidite} ASC`)
    .all();

  const cles = new Set(enVigueur.map((l) => l.cle));

  // Repli, cle par cle et non en bloc : une cle correctement resolue ci-dessus
  // ne doit jamais etre ecrasee par une version plus ancienne.
  const plusAnciennes = base
    .select({ cle: parametre.cle, valeur: parametre.valeur })
    .from(parametre)
    .orderBy(sql`${parametre.dateDebutValidite} DESC`)
    .all()
    .filter((l) => !cles.has(l.cle));

  // `plusAnciennes` est triee en DESCENDANT : `Parametres` gardant la derniere
  // valeur vue, c'est bien la version la plus ANCIENNE qui l'emporte.
  return Parametres.depuisLignes([...plusAnciennes, ...enVigueur]);
}

/** Lignes brutes, pour l'ecran Parametres qui doit montrer source et validite. */
export function listerParametres(base: BaseBatte) {
  return base.select().from(parametre).orderBy(parametre.cle, parametre.dateDebutValidite).all();
}

/* ═══ Gardes d'ecriture ═══════════════════════════════════════════════════
 *
 * Elles vivent ICI et non dans le handler Fastify : ce sont des regles metier
 * (regle d'architecture n°1). Une ecriture passant par un script, un test ou
 * une future route doit buter sur les memes refus qu'une saisie a l'ecran.
 */

/**
 * Le catalogue de `packages/core` est la SEULE source de verite des cles
 * (D-013). Ecrire une cle qu'il ignore creerait un parametre que personne ne
 * lit : `Parametres.entier()` ne connait que les cles du catalogue, donc la
 * valeur saisie n'aurait aucun effet — un reglage fantome, pire qu'une erreur.
 */
function definitionOuLever(cle: string): DefinitionParametre {
  const definition = definitionParametre(cle);
  if (definition === undefined) throw new ErreurIntrouvable('Paramètre', cle);
  return definition;
}

/**
 * Verifie la valeur contre le type DECLARE dans le catalogue, jamais contre une
 * liste de types reecrite ici (DRY) : ajouter un parametre au catalogue suffit
 * a le rendre verifiable, sans toucher a ce fichier.
 *
 * Les suffixes de cle (`_cents`, `_bp`) n'ont pas de regle propre : ils sont
 * declares `entier` au catalogue, donc deja couverts. Une regle en double
 * finirait par diverger.
 */
function verifierValeur(definition: DefinitionParametre, valeur: string): void {
  const refus = (raison: string): never => {
    throw new ErreurMetier('valeur_parametre_invalide', `« ${definition.cle} » : ${raison}`, {
      champs: { valeur: raison },
    });
  };

  /*
   * Le vide est refuse pour tous les types SAUF `texte`.
   *
   * Cette garde attrape un seuil ou un taux laisse en blanc, ce qu'aucun
   * controle de type ne verrait seul : `Number('')` vaut 0, donc un `decimal`
   * vide passerait tranquillement pour zero. Elle reste donc necessaire.
   *
   * Mais un parametre de type `texte` peut legitimement etre VIDE, et c'est
   * ainsi qu'il dit « pas encore renseigne » — cas de `adresse_depart_defaut`
   * (D-065), l'adresse d'ou partent les trajets. Refuser le vide y forcerait a
   * inscrire une valeur par defaut plausible, exactement ce que ce projet
   * interdit : une adresse inventee produirait des distances fausses, donc des
   * couts de deplacement faux, que rien ne signalerait.
   *
   * Le contrat est donc : pour un `texte`, VIDE VEUT DIRE INCONNU, et le code
   * qui le lit doit le traiter comme `null` — jamais comme une chaine
   * utilisable. C'est la meme doctrine que partout ailleurs ici (« une valeur
   * inconnue vaut null, jamais zero »), appliquee a une chaine.
   */
  if (definition.typeValeur !== 'texte' && valeur.trim() === '') {
    refus('la valeur ne peut pas être vide.');
  }

  const controles: Record<TypeValeurParametre, () => void> = {
    // Entiers stricts : CLAUDE.md §3 regle 3 (argent en centimes entiers) et
    // regle 4 (masses et volumes entiers). « 25000,5 » centimes n'existe pas.
    entier: () => {
      if (!/^-?\d+$/.test(valeur)) {
        refus(`« ${valeur} » n'est pas un nombre entier. Attendu : des chiffres, sans virgule.`);
      }
    },
    decimal: () => {
      if (!Number.isFinite(Number(valeur))) {
        refus(`« ${valeur} » n'est pas un nombre. Utilisez le point décimal, par exemple 1.28.`);
      }
    },
    booleen: () => {
      if (valeur !== 'true' && valeur !== 'false') {
        refus(`« ${valeur} » n'est pas un booléen. Attendu : « true » ou « false ».`);
      }
    },
    json: () => {
      try {
        JSON.parse(valeur);
      } catch {
        refus(`« ${valeur} » n'est pas du JSON valide.`);
      }
    },
    // Un texte libre n'a d'autre contrainte que d'exister, deja verifiee.
    texte: () => undefined,
  };

  controles[definition.typeValeur]();
}

/** Jour civil `AAAA-MM-JJ` (CLAUDE.md §3 regle 8). */
const MOTIF_JOUR_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Modifie la valeur en vigueur d'une cle existante.
 *
 * Pour un changement annuel de seuil, ne pas utiliser cette fonction : creer une
 * nouvelle ligne datee avec `ajouterVersionParametre`, afin de conserver
 * l'historique (CLAUDE.md §7 : date de validite et source).
 *
 * **La correction et sa trace d'audit sont dans la meme transaction.** C'est le
 * point le plus sensible du projet : cette table porte les seuils legaux et les
 * taux de cotisation. Une valeur ecrasee sans trace rend impossible de repondre
 * a « quel seuil appliquiez-vous en mars ? ».
 */
export function corrigerParametre(
  base: BaseBatte,
  id: string,
  valeur: string,
  parQui?: string,
): void {
  base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    // Lecture AVANT la mise a jour : c'est la seule occasion de capturer l'etat
    // anterieur, l'`UPDATE` l'aura ecrase juste apres.
    const avant = baseTx.select().from(parametre).where(eq(parametre.id, id)).get();
    if (avant === undefined) throw new ErreurIntrouvable('Paramètre', id);

    // Le type attendu vient du catalogue et non de la colonne `type_valeur` :
    // si les deux divergent, c'est le catalogue qui fait foi (D-013).
    verifierValeur(definitionOuLever(avant.cle), valeur);

    const apres = baseTx
      .update(parametre)
      .set({ valeur, modifieLe: maintenantUtc() })
      .where(eq(parametre.id, id))
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'parametre',
      enregistrementId: id,
      action: 'modification',
      valeurAvant: avant,
      valeurApres: apres,
      parQui: parQui ?? null,
    });
  });
}

/**
 * Nouvelle valeur applicable a partir d'une date, sans ecraser l'ancienne.
 *
 * Journalisee aussi : l'ancienne ligne reste lisible dans la table, mais seul le
 * journal dit QUAND la nouvelle version a ete introduite. La date de debut de
 * validite est declarative — elle peut etre retroactive — donc elle ne renseigne
 * pas sur la date de saisie reelle, que l'AFSCA et le fisc regardent.
 */
export type EntreeVersionParametre = {
  readonly cle: string;
  readonly valeur: string;
  /**
   * Facultatif : le catalogue le declare deja. Fourni, il doit CONCORDER —
   * un appelant qui se trompe de type doit l'apprendre, pas voir sa valeur
   * silencieusement reinterpretee.
   */
  readonly typeValeur?: TypeValeurParametre;
  /** Jour civil `AAAA-MM-JJ` a partir duquel la nouvelle valeur s'applique. */
  readonly dateDebutValidite: string;
  /** Obligatoire : un seuil legal sans source est invérifiable (CLAUDE.md §7). */
  readonly source: string;
  /** Facultatif : reprend celle du catalogue quand elle n'a pas change. */
  readonly description?: string;
};

export function ajouterVersionParametre(
  base: BaseBatte,
  entree: EntreeVersionParametre,
  parQui?: string,
): string {
  const definition = definitionOuLever(entree.cle);
  verifierValeur(definition, entree.valeur);

  if (entree.typeValeur !== undefined && entree.typeValeur !== definition.typeValeur) {
    throw new ErreurMetier(
      'type_parametre_incoherent',
      `« ${entree.cle} » est déclaré « ${definition.typeValeur} » au catalogue, ` +
        `pas « ${entree.typeValeur} ».`,
      { champs: { typeValeur: `Type attendu : ${definition.typeValeur}.` } },
    );
  }

  if (!MOTIF_JOUR_CIVIL.test(entree.dateDebutValidite)) {
    throw new ErreurMetier(
      'date_validite_invalide',
      `« ${entree.dateDebutValidite} » n'est pas une date au format AAAA-MM-JJ.`,
      { champs: { dateDebutValidite: 'Date attendue au format AAAA-MM-JJ.' } },
    );
  }

  if (entree.source.trim() === '') {
    throw new ErreurMetier(
      'source_parametre_manquante',
      `Une nouvelle version de « ${entree.cle} » doit indiquer d'où vient le chiffre.`,
      {
        champs: {
          source: 'Indiquez la source du nouveau chiffre (texte de loi, contrat, mesure).',
        },
      },
    );
  }

  const id = nouvelIdentifiant();
  const maintenant = maintenantUtc();

  return base.transaction((tx) => {
    const baseTx = tx as unknown as BaseBatte;

    /*
     * REFUS DE LA RETROACTIVITE — le coeur du mecanisme.
     *
     * `lireParametres(base, date)` resout les parametres A UNE DATE : une
     * session de mars se relit avec les taux de mars. Antidater une nouvelle
     * version reecrirait donc les pieces comptables deja closes, exactement ce
     * que D-004 / D-024 (agregats figes a la cloture) interdisent.
     *
     * Faire evoluer et corriger sont deux gestes distincts : quand la valeur
     * saisie n'a JAMAIS ete vraie (faute de frappe), c'est `corrigerParametre`
     * qu'il faut, et le message le dit.
     */
    const derniere = baseTx
      .select({ dateDebutValidite: parametre.dateDebutValidite })
      .from(parametre)
      .where(eq(parametre.cle, entree.cle))
      .orderBy(sql`${parametre.dateDebutValidite} DESC`)
      .limit(1)
      .get();

    if (derniere !== undefined && entree.dateDebutValidite <= derniere.dateDebutValidite) {
      const raison =
        `La version en vigueur commence le ${derniere.dateDebutValidite} : une nouvelle ` +
        `version doit démarrer APRÈS cette date. Pour rectifier une valeur qui n'a jamais ` +
        `été exacte, utilisez la correction plutôt qu'une nouvelle version.`;
      throw new ErreurMetier('date_validite_retroactive', raison, {
        champs: { dateDebutValidite: raison },
      });
    }

    const cree = baseTx
      .insert(parametre)
      .values({
        id,
        cle: entree.cle,
        valeur: entree.valeur,
        typeValeur: definition.typeValeur,
        dateDebutValidite: entree.dateDebutValidite,
        dateFinValidite: null,
        source: entree.source,
        description: entree.description ?? definition.description,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .returning()
      .get();

    journaliser(baseTx, {
      table: 'parametre',
      enregistrementId: id,
      action: 'creation',
      valeurApres: cree,
      parQui: parQui ?? null,
    });

    return id;
  });
}
