/**
 * Accord FRANÇAIS d'un compte et du libellé qui le suit.
 *
 * Défaut trouvé lors du rejeu de parcours du 31/07/2026 (docs/27, §3.f) :
 * plusieurs titres de panneau écrivaient le pluriel EN DUR quel que soit le
 * compte — « 1 NON-CONFORMITÉS », « 1 RELEVÉS ». Le français accorde au
 * singulier pour 0 ET 1 (seul 2 et plus prend le pluriel) — c'est l'INVERSE
 * de l'anglais, où 0 est pluriel (« 0 items »). `formaterQuantite`
 * (`packages/core/src/unites.ts`) applique déjà cette règle pour les pièces
 * (« 0 pièce », jamais « 0 pièces ») ; cette fonction la généralise aux
 * libellés d'écran qui ne passent pas par une unité.
 *
 * Les deux formes sont fournies EXPLICITEMENT par l'appelant, jamais
 * devinées par un simple ajout de « s » : « lieu »/« lieux », des groupes de
 * mots entiers avec un adjectif qui s'accorde aussi (« relevé archivé »/
 * « relevés archivés ») ne suivent pas la règle du « s » final, et deviner
 * ferait la même erreur ailleurs.
 */
export function compteAccorde(compte: number, singulier: string, pluriel: string): string {
  return `${compte} ${compte > 1 ? pluriel : singulier}`;
}
