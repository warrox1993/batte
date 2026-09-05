/**
 * Numerotation documentaire sequentielle, sans trou.
 *
 * Ce n'est pas une convention de confort. La tenue de comptabilite informatisee
 * belge impose une numerotation sequentielle controlee par le logiciel et une
 * tenue « par ordre de dates, sans blancs ni lacunes ». Microsoft le formule de
 * la meme facon : « les trous ne sont pas autorises parce que l'historique
 * exact des transactions financieres doit etre disponible pour l'audit, PAR LA
 * LOI » (docs/07 §1.5).
 *
 * L'UUID v7 reste la cle primaire ; ce numero est l'identifiant LISIBLE, celui
 * qu'on cite au telephone a un meunier.
 */

import { maintenantUtc, nouvelIdentifiant } from '@batte/core';
import { and, eq, sql } from 'drizzle-orm';
import type { BaseBatte } from '../client.js';
import { serieNumero } from '../schema.js';

/** Natures de document numerotees, avec leur prefixe et leur regime de trous. */
export const SERIES = {
  reception: { prefixe: 'RC', autoriseTrous: false },
  commande: { prefixe: 'CF', autoriseTrous: false },
  production: { prefixe: 'PR', autoriseTrous: false },
  /** Une session planifiee puis annulee laisse un trou : ce n'est pas financier. */
  session: { prefixe: 'SM', autoriseTrous: true },
  registre: { prefixe: 'RG', autoriseTrous: false },
  inventaire: { prefixe: 'IN', autoriseTrous: false },
} as const;

export type NatureDocument = keyof typeof SERIES;

/**
 * Alloue le numero suivant d'une serie, pour une annee donnee.
 *
 * L'increment se fait en une seule instruction SQL (`dernier_numero + 1`) et
 * non par lecture puis ecriture : entre les deux, un autre appel pourrait
 * allouer le meme numero. Sur une application mono-utilisateur le risque est
 * theorique, mais un numero en double dans un journal comptable ne se rattrape
 * pas.
 *
 * A appeler DANS la transaction qui cree le document : si le document echoue,
 * le numero doit etre annule avec lui, sinon on cree le trou qu'on cherche a
 * eviter.
 */
export function allouerNumero(base: BaseBatte, nature: NatureDocument, annee: number): string {
  const definition = SERIES[nature];
  const maintenant = maintenantUtc();

  const existante = base
    .select({ id: serieNumero.id })
    .from(serieNumero)
    .where(and(eq(serieNumero.nature, nature), eq(serieNumero.annee, annee)))
    .limit(1)
    .all();

  if (existante.length === 0) {
    base
      .insert(serieNumero)
      .values({
        id: nouvelIdentifiant(),
        nature,
        prefixe: definition.prefixe,
        annee,
        dernierNumero: 0,
        autoriseTrous: definition.autoriseTrous,
        creeLe: maintenant,
        modifieLe: maintenant,
      })
      .run();
  }

  const misAJour = base
    .update(serieNumero)
    .set({
      dernierNumero: sql`${serieNumero.dernierNumero} + 1`,
      modifieLe: maintenant,
    })
    .where(and(eq(serieNumero.nature, nature), eq(serieNumero.annee, annee)))
    .returning({ numero: serieNumero.dernierNumero })
    .all();

  const numero = misAJour[0]?.numero;
  if (numero === undefined) {
    throw new Error(`Allocation de numero impossible pour la serie ${nature} ${annee}.`);
  }

  return `${definition.prefixe}-${annee}-${String(numero).padStart(4, '0')}`;
}

/** Dernier numero attribue, pour l'ecran d'administration. */
export function lireSeries(base: BaseBatte) {
  return base.select().from(serieNumero).orderBy(serieNumero.nature, serieNumero.annee).all();
}
