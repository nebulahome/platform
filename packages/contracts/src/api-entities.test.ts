import { describe, expect, it } from 'vitest';

import { entityQuerySchema, entityUpdateSchema, entityViewSchema } from './api-entities.js';

/**
 * An entity as the API serves it, for tests that vary one field.
 *
 * @returns The row.
 */
function entity(): Record<string, unknown> {
  return {
    entityId: 'switch.shelly_bench_switch',
    domain: 'switch',
    name: 'Switch',
    icon: 'switch',
    areaKey: null,
    areaName: null,
    deviceId: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
    source: 'shelly-bench',
    unitOfMeasurement: null,
    deviceClass: null,
    isEnabled: true,
    isHidden: false,
    capabilities: [{ capability: 'on_off', params: {} }],
    searchAliases: [],
    state: null,
    attributes: {},
    isAvailable: false,
    lastChanged: null,
    lastUpdated: null,
  };
}

describe('entityViewSchema', () => {
  it('lists the tags on an entity by id, none until some are put on it', () => {
    expect(entityViewSchema.parse(entity()).tagIds).toEqual([]);
    expect(
      entityViewSchema.parse({ ...entity(), tagIds: ['018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f'] })
        .tagIds,
    ).toEqual(['018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f']);
  });
});

describe('entityQuerySchema', () => {
  it('narrows to a tag by its key', () => {
    expect(entityQuerySchema.parse({ tag: 'exterior' }).tag).toBe('exterior');
    expect(entityQuerySchema.safeParse({ tag: 'Not A Key' }).success).toBe(false);
  });
});

describe('entityUpdateSchema', () => {
  it('refuses an empty change', () => {
    expect(entityUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('takes a rename on its own, trimmed', () => {
    expect(entityUpdateSchema.parse({ name: '  Bench relay ' })).toEqual({ name: 'Bench relay' });
    expect(entityUpdateSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('lets the owner pick an icon or clear it', () => {
    expect(entityUpdateSchema.parse({ icon: 'plug' }).icon).toBe('plug');
    expect(entityUpdateSchema.parse({ icon: null }).icon).toBeNull();
    expect(entityUpdateSchema.safeParse({ icon: 'Not An Id' }).success).toBe(false);
  });

  it('takes the whole set of tags the entity should carry, by id', () => {
    const tagIds = ['018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f'];

    expect(entityUpdateSchema.parse({ tagIds }).tagIds).toEqual(tagIds);
    expect(entityUpdateSchema.safeParse({ tagIds: ['exterior'] }).success).toBe(false);
  });

  it('never takes the identifier: renaming changes the name, not the address', () => {
    expect(entityUpdateSchema.safeParse({ entityId: 'switch.other' }).success).toBe(false);
  });
});
