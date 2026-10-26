/**
 * Seeding a scene member from an entity's current reading.
 */
import { describe, expect, it } from 'vitest';

import { entityIdSchema, type EntityView } from '@nebulahome/contracts';

import { isSceneEntity, seedTargetState } from './scene-target-state';

const LAMP: EntityView = {
  entityId: entityIdSchema.parse('light.hallway_ceiling'),
  domain: 'light',
  name: 'Ceiling',
  icon: null,
  areaKey: null,
  areaName: null,
  deviceId: null,
  source: 'test',
  unitOfMeasurement: null,
  deviceClass: null,
  isEnabled: true,
  isHidden: false,
  capabilities: [
    { capability: 'on_off', params: {} },
    { capability: 'level', params: {} },
    { capability: 'sensor_numeric', params: {} },
  ],
  searchAliases: [],
  state: {
    on_off: { isOn: true },
    level: { level: 40 },
    sensor_numeric: { value: 21 },
  },
  attributes: {},
  isAvailable: true,
  lastChanged: null,
  lastUpdated: null,
  tagIds: [],
  addresses: [],
  linked: null,
  key: null,
  createdAt: null,
  original: null,
};

describe('seedTargetState', () => {
  it('keeps writable capabilities and drops sensors', () => {
    expect(seedTargetState(LAMP)).toEqual({
      on_off: { isOn: true },
      level: { level: 40 },
    });
  });

  it('rejects a sensor-only entity', () => {
    expect(
      isSceneEntity({
        ...LAMP,
        capabilities: [{ capability: 'sensor_numeric', params: {} }],
      }),
    ).toBe(false);
  });
});
