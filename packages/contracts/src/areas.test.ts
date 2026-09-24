import { describe, expect, it } from 'vitest';

import {
  AREA_KINDS,
  areaCreateSchema,
  areaUpdateSchema,
  areaViewSchema,
  tileCacheStatusSchema,
  tilePrefetchResultSchema,
} from './areas.js';

const HOUSE_ID = '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f';

describe('the kinds', () => {
  it('are a house, a floor and a room, in that order down the tree', () => {
    expect(AREA_KINDS).toEqual(['house', 'floor', 'room']);
  });
});

describe('areaCreateSchema', () => {
  it('takes a house with a name and a position, and no parent', () => {
    expect(
      areaCreateSchema.parse({ kind: 'house', name: ' Home ', latitude: 45.4, longitude: 9.19 }),
    ).toEqual({ kind: 'house', name: 'Home', latitude: 45.4, longitude: 9.19 });
  });

  it('takes a house without a position, to be placed later', () => {
    expect(areaCreateSchema.safeParse({ kind: 'house', name: 'Home' }).success).toBe(true);
  });

  it('refuses a house with a parent: a house is the top of its tree', () => {
    expect(
      areaCreateSchema.safeParse({ kind: 'house', name: 'Home', parentId: HOUSE_ID }).success,
    ).toBe(false);
  });

  it('needs a parent for a floor and for a room', () => {
    expect(
      areaCreateSchema.safeParse({ kind: 'floor', name: 'Ground floor', level: 0 }).success,
    ).toBe(false);
    expect(
      areaCreateSchema.safeParse({
        kind: 'floor',
        name: 'Ground floor',
        parentId: HOUSE_ID,
        level: 0,
      }).success,
    ).toBe(true);
    expect(areaCreateSchema.safeParse({ kind: 'room', name: 'Kitchen' }).success).toBe(false);
  });

  it('needs a number for a floor, and takes one for nothing else', () => {
    expect(
      areaCreateSchema.safeParse({ kind: 'floor', name: 'Ground floor', parentId: HOUSE_ID })
        .success,
    ).toBe(false);
    expect(
      areaCreateSchema.safeParse({ kind: 'floor', name: 'Cellar', parentId: HOUSE_ID, level: -1 })
        .success,
    ).toBe(true);
    expect(
      areaCreateSchema.safeParse({ kind: 'room', name: 'Kitchen', parentId: HOUSE_ID, level: 1 })
        .success,
    ).toBe(false);
    expect(
      areaCreateSchema.safeParse({ kind: 'floor', name: 'Loft', parentId: HOUSE_ID, level: 1.5 })
        .success,
    ).toBe(false);
  });

  it('refuses a position on anything but a house', () => {
    expect(
      areaCreateSchema.safeParse({
        kind: 'room',
        name: 'Kitchen',
        parentId: HOUSE_ID,
        latitude: 45.4,
        longitude: 9.19,
      }).success,
    ).toBe(false);
  });

  it('refuses one coordinate without the other, and one off the globe', () => {
    expect(
      areaCreateSchema.safeParse({ kind: 'house', name: 'Home', latitude: 45.4 }).success,
    ).toBe(false);
    expect(
      areaCreateSchema.safeParse({ kind: 'house', name: 'Home', latitude: 91, longitude: 0 })
        .success,
    ).toBe(false);
    expect(
      areaCreateSchema.safeParse({ kind: 'house', name: 'Home', latitude: 0, longitude: 181 })
        .success,
    ).toBe(false);
  });

  it('takes an icon by its catalogue id', () => {
    expect(
      areaCreateSchema.parse({
        kind: 'room',
        name: 'Kitchen',
        parentId: HOUSE_ID,
        icon: 'cooking-pot',
      }).icon,
    ).toBe('cooking-pot');
  });
});

describe('areaUpdateSchema', () => {
  it('refuses an empty change', () => {
    expect(areaUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('takes a rename, a new icon, or none', () => {
    expect(areaUpdateSchema.parse({ name: 'Studio' })).toEqual({ name: 'Studio' });
    expect(areaUpdateSchema.parse({ icon: null }).icon).toBeNull();
  });

  it('moves a house, or takes its position away, both coordinates together', () => {
    expect(areaUpdateSchema.safeParse({ latitude: 45.4, longitude: 9.19 }).success).toBe(true);
    expect(areaUpdateSchema.safeParse({ latitude: null, longitude: null }).success).toBe(true);
    expect(areaUpdateSchema.safeParse({ latitude: 45.4 }).success).toBe(false);
    expect(areaUpdateSchema.safeParse({ latitude: 45.4, longitude: null }).success).toBe(false);
  });

  it('never takes a kind or a key: both are fixed at creation', () => {
    expect(areaUpdateSchema.safeParse({ kind: 'floor' }).success).toBe(false);
    expect(areaUpdateSchema.safeParse({ key: 'studio' }).success).toBe(false);
  });
});

describe('areaViewSchema', () => {
  it('says what kind an area is, where a house stands, and what is in it', () => {
    const view = areaViewSchema.parse({
      id: HOUSE_ID,
      key: 'home',
      name: 'Home',
      kind: 'house',
      parentId: null,
      icon: null,
      sortOrder: 100,
      level: null,
      latitude: 45.4,
      longitude: 9.19,
      deviceCount: 0,
      entityCount: 0,
    });

    expect([view.kind, view.latitude, view.longitude]).toEqual(['house', 45.4, 9.19]);
  });
});

describe('the tile cache', () => {
  it('reports how much of the buffer around a house is on disk', () => {
    expect(tileCacheStatusSchema.parse({ total: 180, cached: 12 })).toEqual({
      total: 180,
      cached: 12,
    });
  });

  it('reports what a prefetch did', () => {
    expect(tilePrefetchResultSchema.parse({ total: 180, cached: 178, failed: 2 })).toEqual({
      total: 180,
      cached: 178,
      failed: 2,
    });
  });
});
