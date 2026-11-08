/**
 * The entity dialog's frame: History folds its drawer open, Settings lifts its sheet over the
 * controls and hides them from a screen reader, a feature the entity does not have is not drawn
 * at all, and a capability with no body of its own still gets the platform's control. Settings
 * send only what changed, stay read-only for someone who may not change them, and offer Unlink
 * for a linked reading when the dialog is given a way to. A lamp's White | Colour answers at once.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EntityView, StateHistoryPoint } from '@nebulahome/contracts';

import type * as LibraryApi from '@/library/api';
import { capabilityStateOf } from '@/library/entity-control';
import { EntitySheet, type EntitySheetProps } from '@/routes/library/entity/sheet/entity-sheet';
import { anEntity } from '@/testing/fixtures';
import { LINKED_SAMPLE_ENTITIES } from '@/testing/linked-samples';

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
 * @param extra - Props besides the usual.
 * @returns A way to draw it again with other props, as a report arriving would.
 */
function show(
  entity: EntityView,
  states: StateHistoryPoint[] = [],
  extra: Partial<EntitySheetProps> = {},
): (more: Partial<EntitySheetProps>) => void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  /**
   * The dialog, with props besides the usual.
   *
   * @param more - Those props.
   * @returns It.
   */
  const dialog = (more: Partial<EntitySheetProps>) => (
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
        {...more}
      />
    </QueryClientProvider>
  );
  const { rerender } = render(dialog(extra));

  return (more) => {
    rerender(dialog({ ...extra, ...more }));
  };
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

  it('gives a capability with no body of its own the platform’s control', () => {
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

    expect(screen.getAllByText('Recording').length).toBeGreaterThan(0);
  });

  it('opens on its settings when asked, and saves only what changed', () => {
    const onSave = vi.fn();

    show(LAMP, [], { initialView: 'settings', onSave });

    fireEvent.change(screen.getByRole('textbox', { name: 'Icon and name' }), {
      target: { value: 'Island' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({ update: { name: 'Island' } });
  });

  it('shows the settings read-only, with no Save, to someone who may not change them', () => {
    show(LAMP, [], { initialView: 'settings', canEdit: false });

    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(
      screen.getByRole('textbox', { name: 'Icon and name' }).closest('fieldset')?.disabled,
    ).toBe(true);
  });

  it('offers Unlink in the settings of a linked reading', () => {
    const onUnlink = vi.fn();
    const [linked] = LINKED_SAMPLE_ENTITIES;

    if (linked === undefined) {
      throw new Error('No linked sample');
    }

    show(linked, [], { initialView: 'settings', onUnlink });
    fireEvent.click(screen.getByRole('button', { name: 'Unlink…' }));

    expect(onUnlink).toHaveBeenCalledOnce();
  });

  it('turns a lamp to its colour at once, and tints a white lamp by its white', () => {
    const send = vi.fn();
    const lamp = anEntity({
      entityId: 'light.desk',
      name: 'Desk lamp',
      capabilities: [
        { capability: 'on_off', params: {} },
        { capability: 'level', params: {} },
        { capability: 'color_hs', params: {} },
        { capability: 'color_temp', params: { minMireds: 153, maxMireds: 500 } },
      ],
      state: {
        on_off: { isOn: true },
        level: { level: 60 },
        color_hs: { hue: 200, saturation: 80 },
        color_temp: { mireds: 370 },
      },
    });

    const update = show(lamp, [], { commander: { send, busy: new Set(), problem: null } });

    // Saying neither, it shows its white, and its switch takes that white.
    expect(screen.getByRole('slider', { name: 'Colour temperature' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Desk lamp' }).style.backgroundColor).toMatch(
      /^rgb/u,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Colour' }));

    expect(send).toHaveBeenCalledWith('color_hs', {
      command: 'set_color',
      hue: 200,
      saturation: 80,
    });
    expect(screen.getByRole('button', { name: 'Rose' })).toBeTruthy();
    expect(screen.queryByRole('slider', { name: 'Colour temperature' })).toBeNull();

    // The lamp answers without saying which it shows: the colour pressed stays.
    update({ reportedAt: Date.now() + 1000 });

    expect(screen.getByRole('button', { name: 'Rose' })).toBeTruthy();
  });
});
