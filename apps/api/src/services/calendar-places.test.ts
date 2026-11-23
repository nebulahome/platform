import { describe, expect, it } from 'vitest';

import { listPlaces, suggestPlace } from './calendar-places.js';

describe('the place selects', () => {
  it('lists every country, and nothing else until one is chosen', () => {
    const places = listPlaces({}, 'it');

    expect(places.countries).toContainEqual({ code: 'IT', name: 'Italia' });
    expect([places.regions, places.towns]).toEqual([[], []]);
  });

  it("lists Italy's twenty regions under the holidays' codes where they have some, and Alto Adige apart", () => {
    const { regions } = listPlaces({ country: 'IT' }, 'it');

    expect(regions).toHaveLength(21);
    expect(regions).toContainEqual({ code: '25', name: 'Lombardia' });
    expect(regions).toContainEqual({ code: '05', name: 'Emilia-Romagna' });
    expect(regions).toContainEqual({ code: '32', name: 'Alto Adige' });
    expect(regions).toContainEqual({ code: '17', name: 'Trentino-Alto Adige' });
  });

  it("offers a region's capitals until a town is typed, then the towns that match, accents aside", () => {
    const capitals = listPlaces({ country: 'IT', region: '25' }, 'it').towns;
    const typed = listPlaces({ country: 'IT', region: '05', q: 'forli' }, 'it').towns;

    expect(capitals.every((town) => town.isCapital)).toBe(true);
    expect(capitals.find((town) => town.town === 'Milano')?.patronName).toBe("Sant'Ambrogio");
    expect(typed[0]).toEqual({
      town: 'Forlì',
      name: 'Forlì',
      province: 'FC',
      patronName: 'Madonna del Fuoco',
      isCapital: true,
    });
  });

  it('keeps Alto Adige to the province of Bolzano, and offers no town for an unknown region', () => {
    const towns = listPlaces({ country: 'IT', region: '32', q: 'tren' }, 'it').towns;

    expect(towns.every((town) => town.province === 'BZ')).toBe(true);
    expect(listPlaces({ country: 'IT', region: 'constructor', q: 'a' }, 'it').towns).toEqual([]);
  });

  it('has no towns outside Italy', () => {
    expect(listPlaces({ country: 'FR', q: 'Paris' }, 'fr').towns).toEqual([]);
  });
});

describe('the suggested place', () => {
  it('names the town nearest the house, a small one without a listed patron included', () => {
    expect(suggestPlace({ latitude: 45.5276, longitude: 9.0409 })).toEqual({
      country: 'IT',
      region: '25',
      town: 'Rho',
    });
    expect(suggestPlace({ latitude: 46.4983, longitude: 11.3548 })).toMatchObject({
      region: '32',
    });
  });

  it('suggests nothing without a position, or far from Italy', () => {
    expect(suggestPlace(null)).toBeNull();
    expect(suggestPlace({ latitude: 48.8566, longitude: 2.3522 })).toBeNull();
  });
});
