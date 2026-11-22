/**
 * Which live readings tell an activity card that what it follows changed.
 */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { parseEntityId } from '@nebulahome/contracts';

import { LIBRARY_QUERY_KEYS } from '@/library/api';
import type { LiveReading } from '@/live/live-store';
import { anEntity } from '@/testing/fixtures';

import { hasActivityChanged } from './timeline-data';

/** A light's reading. */
const READING: LiveReading = {
  state: { on_off: { isOn: true } },
  attributes: {},
  isAvailable: true,
  changedAt: new Date('2026-11-21T10:00:00Z'),
  receivedAt: 0,
};

/** The readings before: the kitchen light, as it was. */
const BEFORE = { 'light.kitchen': READING };

/** The readings now: the kitchen light as it was, and the porch light new. */
const NOW = { 'light.kitchen': READING, 'light.porch': { ...READING } };

describe('hasActivityChanged', () => {
  const queryClient = new QueryClient();

  queryClient.setQueryData(LIBRARY_QUERY_KEYS.entities, [
    anEntity({ entityId: 'light.kitchen', areaKey: 'kitchen' }),
    anEntity({ entityId: 'light.porch', areaKey: 'garden' }),
  ]);

  it('follows the entities a card names, and only those', () => {
    expect(
      hasActivityChanged(
        { kind: 'entities', entityIds: [parseEntityId('light.porch')] },
        NOW,
        BEFORE,
        queryClient,
      ),
    ).toBe(true);
    expect(
      hasActivityChanged(
        { kind: 'entities', entityIds: [parseEntityId('light.kitchen')] },
        NOW,
        BEFORE,
        queryClient,
      ),
    ).toBe(false);
  });

  it('follows the entities of an area, as the entities list places them', () => {
    expect(hasActivityChanged({ kind: 'area', areaKey: 'garden' }, NOW, BEFORE, queryClient)).toBe(
      true,
    );
    expect(hasActivityChanged({ kind: 'area', areaKey: 'kitchen' }, NOW, BEFORE, queryClient)).toBe(
      false,
    );
  });

  it('follows every entity for the house, but not readings forgotten after a drop', () => {
    expect(hasActivityChanged({ kind: 'house' }, NOW, BEFORE, queryClient)).toBe(true);
    expect(hasActivityChanged({ kind: 'house' }, {}, NOW, queryClient)).toBe(false);
  });

  it('takes a report that repeats the state and the reach as no change', () => {
    const repeated = { 'light.kitchen': { ...READING, receivedAt: 1 } };

    expect(hasActivityChanged({ kind: 'house' }, repeated, BEFORE, queryClient)).toBe(false);
  });

  it('takes a change of reach alone as a change', () => {
    const lost = { 'light.kitchen': { ...READING, isAvailable: false } };

    expect(hasActivityChanged({ kind: 'house' }, lost, BEFORE, queryClient)).toBe(true);
  });

  it('leaves out an entity the activity never shows: a number measured', () => {
    const client = new QueryClient();

    client.setQueryData(LIBRARY_QUERY_KEYS.entities, [
      anEntity({
        entityId: 'sensor.power',
        capabilities: [{ capability: 'sensor_numeric', params: {} }],
      }),
    ]);

    const before = { 'sensor.power': READING };
    const now = { 'sensor.power': { ...READING, changedAt: new Date('2026-11-21T10:00:01Z') } };

    expect(hasActivityChanged({ kind: 'house' }, now, before, client)).toBe(false);
  });
});
