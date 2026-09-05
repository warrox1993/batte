/**
 * Route de LECTURE du journal d'audit.
 *
 * CLAUDE.md §3 regle 7 exige un « journal d'audit sur toutes les tables
 * sensibles ». Il etait tenu — huit sites appellent `journaliser` — et
 * strictement illisible : `listerJournalAudit` n'avait aucun appelant de
 * production et aucune route ne l'exposait (`docs/13` §4.9). Un journal qu'on
 * ne peut pas ouvrir coute des ecritures et ne rend aucun service, y compris a
 * un controleur.
 *
 * Les deux questions reelles auxquelles cette route repond :
 *   — « qui a change ce seuil, et quand ? »
 *   — « pourquoi cette valeur a-t-elle bouge entre deux exercices ? »
 *
 * LECTURE SEULE, definitivement. Aucun verbe d'ecriture n'est declare ici :
 * `journaliser` s'appelle DANS la transaction qui modifie la donnee, jamais
 * depuis HTTP. Un journal alimentable de l'exterieur ne prouve plus rien.
 *
 * Statuts (D-035) : 422 avec `champs` quand un parametre de requete est
 * invalide, pour que l'ecran sache sur quel controle accrocher le message. Il
 * n'y a pas de 404 possible : le journal n'a pas de ressource adressee par
 * l'URL, une recherche sans resultat rend une liste vide.
 */

import type { FastifyPluginAsync } from 'fastify';
import { ErreurMetier, schemaJournalAudit, type ActionAuditContrat } from '@batte/core';
import {
  listerJournalAudit,
  // `tablesTracees` (packages/db/src/depots/audit.ts) EST reexportee par le
  // barillet `packages/db/src/index.ts` (verifie le 30/07/2026) : un
  // commentaire anterieur affirmait le contraire — corrige, un commentaire
  // qui ment est pire qu'un commentaire absent (D-040).
  tablesTracees,
  type FiltreJournalAudit,
  type BaseBatte,
} from '@batte/db';

/**
 * Plafond de lignes rendues.
 *
 * Ce n'est PAS une valeur metier au sens de CLAUDE.md §7 (aucun taux, aucun
 * seuil legal, aucun montant) : c'est un garde-fou de transport, du meme ordre
 * que la taille maximale d'un corps HTTP. Il n'a donc pas sa place dans la
 * table `parametre`, qui porte des regles datees et sourcees.
 *
 * 500 : environ trente ecrans de tableau. Au-dela, on ne lit plus un journal,
 * on l'exporte — et l'export du journal n'existe pas encore.
 */
const LIMITE_DEFAUT = 200;
const LIMITE_MAXIMALE = 500;

const ACTIONS: readonly ActionAuditContrat[] = ['creation', 'modification', 'annulation'];

/** `AAAA-MM-JJ` strict. Une date approximative filtrerait a cote sans le dire. */
const JOUR_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

function analyserJour(brut: string | undefined, champ: string): string | undefined {
  if (brut === undefined || brut === '') return undefined;
  if (!JOUR_CIVIL.test(brut)) {
    throw new ErreurMetier('date_invalide', `Date invalide : « ${brut} ».`, {
      champs: { [champ]: 'Indiquez un jour au format AAAA-MM-JJ.' },
    });
  }
  return brut;
}

function analyserAction(brut: string | undefined): ActionAuditContrat | undefined {
  if (brut === undefined || brut === '') return undefined;
  const trouvee = ACTIONS.find((action) => action === brut);
  if (trouvee === undefined) {
    throw new ErreurMetier('action_invalide', `Action inconnue : « ${brut} ».`, {
      champs: { action: 'Choisissez une action dans la liste.' },
    });
  }
  return trouvee;
}

function analyserLimite(brut: string | undefined): number {
  if (brut === undefined || brut === '') return LIMITE_DEFAUT;
  const valeur = Number.parseInt(brut, 10);
  if (!Number.isInteger(valeur) || valeur <= 0 || valeur > LIMITE_MAXIMALE) {
    throw new ErreurMetier('limite_invalide', `Limite invalide : « ${brut} ».`, {
      champs: { limite: `Indiquez un entier entre 1 et ${LIMITE_MAXIMALE}.` },
    });
  }
  return valeur;
}

type FiltresRequete = {
  table?: string;
  action?: string;
  enregistrementId?: string;
  depuis?: string;
  jusqua?: string;
  limite?: string;
};

export function routesAudit(base: BaseBatte): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Querystring: FiltresRequete }>('/audit', async (requete) => {
      const { table, enregistrementId } = requete.query;
      const action = analyserAction(requete.query.action);
      const depuis = analyserJour(requete.query.depuis, 'depuis');
      const jusqua = analyserJour(requete.query.jusqua, 'jusqua');
      const limite = analyserLimite(requete.query.limite);

      if (depuis !== undefined && jusqua !== undefined && depuis > jusqua) {
        throw new ErreurMetier(
          'periode_invalide',
          `La période est à l'envers : ${depuis} est postérieur à ${jusqua}.`,
          { champs: { depuis: 'La date de début doit précéder la date de fin.' } },
        );
      }

      // Reconstruction champ par champ plutot qu'un spread : sous
      // `exactOptionalPropertyTypes`, poser `table: undefined` n'est PAS la
      // meme chose que ne pas poser `table`.
      const filtre: FiltreJournalAudit = {
        ...(table === undefined || table === '' ? {} : { table }),
        ...(enregistrementId === undefined || enregistrementId === '' ? {} : { enregistrementId }),
        ...(action === undefined ? {} : { action }),
        ...(depuis === undefined ? {} : { depuis }),
        ...(jusqua === undefined ? {} : { jusqua }),
      };

      /**
       * Lecture SANS plafond, puis decoupe ici.
       *
       * Le plafond du depot rendrait `total` egal a `limite` : l'ecran
       * annoncerait « 200 entrées » sur un journal qui en compte 4 000, et une
       * troncature invisible sur un journal d'audit est une preuve d'absence
       * qui ne prouve rien. Sur une base mono-utilisateur locale le cout est
       * negligeable ; le jour ou il cessera de l'etre, c'est un `COUNT(*)` qui
       * devra descendre dans `depots/audit.ts`.
       */
      const lignes = listerJournalAudit(base, filtre);

      // Tables REELLEMENT tracees, pour alimenter le filtre de l'ecran —
      // voir `tablesTracees` (packages/db/src/depots/audit.ts).
      const tables = tablesTracees(base);

      return schemaJournalAudit.parse({
        data: lignes.slice(0, limite),
        meta: {
          total: lignes.length,
          limite,
          tronque: lignes.length > limite,
          tables,
        },
      });
    });
  };
}
