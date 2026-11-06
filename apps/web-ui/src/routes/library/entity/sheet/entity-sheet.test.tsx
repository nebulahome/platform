/**
 * The entity dialog's frame: History folds its drawer open, Settings lifts its sheet over the
 * controls and hides them from a screen reader, a feature the entity does not have is not drawn
 * at all, and a capability with no body of its own still gets the entity page's control.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EntityView, StateHistoryPoint } from '@nebulahome/contracts';

import type * as LibraryApi from '@/library/api';
import { capabilityStateOf } from '@/library/entity-control';
import { EntitySheet } from '@/routes/library/entity/sheet/entity-sheet';
import { anEntity } from '@/testing/fixtures';

vi.mock('@/library/api', async (original) => ({
  ...(await original<typeof LibraryApi>()),
  fetchAreas: vi.fn(async () => Promise.resolve([])),
  fetchTags: vi.fn(async () => Promise.resolve([])),
  fetchVendors: vi.fn(async () => Promise.resolve([])),
  fetchIcons: vi.fn(async () => Promise.resolve([])),
}));

/** The time the dialog is drawn at. */
const NOW = Date.parse('2026-11-06T12:00:00Z');

/**
 * Draws the dialog for an entity.
 *
 * @param entity - The entity.
 * @param states - Its history.
 */
function show(entity: EntityView, states: StateHistoryPoint[] = []): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <EntitySheet
        entity={entity}
        state={capabilityStateOf(entity, undefined)}
        reportedAt={null}
        commander={{ send: vi.fn(), busy: new Set(), problem: null }}
        disabled={false}
        history={{
          range: '24h',
          onRange: vi.fn(),
          window: { from: NOW - 86_400_000, to: NOW },
          states,
          telemetry: [],
        }}
        battery={null}
        now={NOW}
        deviceName="Kitchen relay"
        onClose={vi.fn()}
        onSave={vi.fn()}
        onEnable={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

/** A dimmable lamp, on at 60%. */
const LAMP = anEntity({
  entityId: 'light.island',
  name: 'Island lights',
  capabilities: [
    { capability: 'on_off', params: {} },
    { capability: 'level', params: {} },
  ],
  state: { on_off: { isOn: true }, level: { level: 60 } },
});

describe('the entity dialog', () => {
  it('folds its history open and shut with the History button', () => {
    show(LAMP);

    const history = screen.getByRole('button', { name: 'History' });

    expect(history.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(history);
    expect(history.getAttribute('aria-pressed')).toBe('true');
  });

  it('lifts its settings over the controls, hiding them from a screen reader', () => {
    show(LAMP);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(
      screen
        .getByRole('slider', { name: 'Brightness', hidden: true })
        .closest('[aria-hidden]')
        ?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(screen.getByText('Icon and name')).toBeTruthy();
  });

  it('draws no brightness for a lamp that only switches, never a greyed one', () => {
    show(
      anEntity({ entityId: 'light.pendant', name: 'Pendant', state: { on_off: { isOn: false } } }),
    );

    expect(screen.queryByRole('slider', { name: 'Brightness' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Pendant' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('says how long a sensor has been silent, and keeps its last value', () => {
    show(
      anEntity({
        entityId: 'sensor.garden_temperature',
        name: 'Garden temperature',
        capabilities: [{ capability: 'sensor_numeric', params: {} }],
        state: { sensor_numeric: { value: 21.8 } },
        unitOfMeasurement: '°C',
        isAvailable: false,
        lastUpdated: new Date(NOW - 3 * 3_600_000),
      }),
    );

    expect(screen.getByText(/Not answering for 3 h/u)).toBeTruthy();
    expect(screen.getByText('21.8')).toBeTruthy();
  });

  it('gives a capability with no body of its own the entity page’s control', () => {
    show(
      anEntity({
        entityId: 'custom.lab_item',
        name: 'Recording',
        capabilities: [
          { capability: 'custom', params: { packageId: 'pkg-template', type: 'item' } },
        ],
        state: { custom: { values: {} } },
      }),
    );

    expect(screen.getByRole('dialog', { name: 'Recording' })).toBeTruthy();
  });
});
