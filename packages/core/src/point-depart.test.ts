import { describe, expect, it } from 'vitest';
import { resoudrePointDepartSession } from './point-depart.js';

describe('resoudrePointDepartSession', () => {
  it('retient le point de départ de la session quand il est renseigné', () => {
    const resultat = resoudrePointDepartSession({
      pointDepartTexteSession: 'Chez le meunier, rue X, Liège',
      adresseDepartDefautParametre: 'Domicile, rue Y, Herstal',
    });
    expect(resultat.texte).toBe('Chez le meunier, rue X, Liège');
    expect(resultat.raisonIndisponible).toBeNull();
  });

  it("retombe sur l'adresse par défaut quand la session ne surcharge pas (cas courant)", () => {
    const resultat = resoudrePointDepartSession({
      pointDepartTexteSession: null,
      adresseDepartDefautParametre: 'Domicile, rue Y, Herstal',
    });
    expect(resultat.texte).toBe('Domicile, rue Y, Herstal');
    expect(resultat.raisonIndisponible).toBeNull();
  });

  it('rend null des deux côtés avec une raison nommée quand rien n’est renseigné', () => {
    const resultat = resoudrePointDepartSession({
      pointDepartTexteSession: null,
      adresseDepartDefautParametre: null,
    });
    expect(resultat.texte).toBeNull();
    expect(resultat.raisonIndisponible).toBe(
      "Adresse de départ non renseignée : le coût de déplacement n'est pas calculable.",
    );
  });

  it('traite une adresse par défaut vide (paramètre jamais saisi) comme absente, pas comme une adresse', () => {
    // `adresse_depart_defaut` vaut '' par défaut au catalogue (packages/core/src/parametres.ts) :
    // une chaîne vide n'est PAS une adresse, jamais traitée comme telle.
    const resultat = resoudrePointDepartSession({
      pointDepartTexteSession: null,
      adresseDepartDefautParametre: '',
    });
    expect(resultat.texte).toBeNull();
    expect(resultat.raisonIndisponible).not.toBeNull();
  });

  it('traite un point de départ de session fait uniquement de blancs comme absent', () => {
    const resultat = resoudrePointDepartSession({
      pointDepartTexteSession: '   ',
      adresseDepartDefautParametre: 'Domicile, rue Y, Herstal',
    });
    expect(resultat.texte).toBe('Domicile, rue Y, Herstal');
  });

  it('coupe les blancs superflus autour du texte retenu', () => {
    const resultat = resoudrePointDepartSession({
      pointDepartTexteSession: '  Chez le meunier  ',
      adresseDepartDefautParametre: null,
    });
    expect(resultat.texte).toBe('Chez le meunier');
  });

  it('la session prime toujours sur le défaut, même quand les deux sont renseignés', () => {
    const resultat = resoudrePointDepartSession({
      pointDepartTexteSession: 'Autre marché',
      adresseDepartDefautParametre: 'Domicile',
    });
    expect(resultat.texte).toBe('Autre marché');
  });
});
