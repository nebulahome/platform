import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutomationView, SceneView } from '@nebulahome/contracts';
import { Modal } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { DASHBOARD_QUERY_KEYS } from '@/dashboard/api';
import type * as LibraryApi from '@/library/api';
import { applyScene, LIBRARY_QUERY_KEYS, updateAutomation } from '@/library/api';
import { PACKAGE_QUERY_KEYS } from '@/packages/api';
import { CommandPalette } from '@/palette/command-palette';
import { usePaletteStore } from '@/palette/palette-store';
import { SAMPLE_OWNER } from '@/testing/backup-samples';
import { anEntity } from '@/testing/fixtures';

vi.mock('@/library/api', async (original) => ({
  ...(await original<typeof LibraryApi>()),
  applyScene: vi.fn(async () => Promise.resolve({ results: [] })),
  updateAutomation: vi.fn(async (id: string) => Promise.resolve({ id })),
}));

const RECENTS_KEY = `nebula.palette.recents.${SAMPLE_OWNER.id}`;

const SCENE = {
  id: '0193a5c2-7d1e-7b4a-9f3e-2c6d8a41b7e1',
  key: 'evening',
  name: 'Evening lights',
  icon: null,
  areaKey: null,
  rollbackOnPartialFailure: false,
  members: [],
  unresolvedMembers: [],
} as unknown as SceneView;

const AUTOMATION = {
  id: '0193a5c2-7d1e-7b4a-9f3e-2c6d8a41b7f1',
  key: 'sunset',
  name: 'Hallway light at sunset',
  description: '',
  isEnabled: true,
  missingEntities: [],
} as unknown as AutomationView;

/**
 * Where the sample app is, as text.
 *
 * @returns The line.
 */
function Address() {
  const location = useLocation();

  return <output data-testid="address">{`${location.pathname}${location.search}`}</output>;
}

/**
 * Opens the palette over a sample house with every permission.
 *
 * @param lights - How many lights the house has.
 * @returns The rendered app.
 */
function renderPalette(lights = 3) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });

  client.setQueryData(
    LIBRARY_QUERY_KEYS.entities,
    Array.from({ length: lights }, (slot, index) =>
      anEntity({ entityId: `light.lamp_${String(index)}`, name: `Lamp ${String(index)}` }),
    ),
  );

  for (const key of [
    LIBRARY_QUERY_KEYS.devices,
    LIBRARY_QUERY_KEYS.areas,
    LIBRARY_QUERY_KEYS.tags,
    LIBRARY_QUERY_KEYS.vendors,
    DASHBOARD_QUERY_KEYS.dashboards,
    PACKAGE_QUERY_KEYS.list,
  ]) {
    client.setQueryData(key, []);
  }

  client.setQueryData(LIBRARY_QUERY_KEYS.scenes, [SCENE]);
  client.setQueryData(LIBRARY_QUERY_KEYS.automations, [AUTOMATION]);
  usePaletteStore.setState({ isOpen: true });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/devices']}>
        <CommandPalette />
        <Address />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * The text of the active row.
 *
 * @returns Its text.
 */
function activeRow(): string {
  const id = screen.getByRole('combobox').getAttribute('aria-activedescendant') ?? '';

  return globalThis.document.getElementById(id)?.textContent ?? '';
}

/**
 * Types into the field.
 *
 * @param value - What it holds after.
 */
function type(value: string): void {
  fireEvent.change(screen.getByRole('combobox'), { target: { value } });
}

/**
 * Presses a key in the field.
 *
 * @param key - Which.
 */
function press(key: string): void {
  fireEvent.keyDown(screen.getByRole('combobox'), { key });
}

describe('CommandPalette', () => {
  beforeEach(() => {
    useSession.setState({ user: SAMPLE_OWNER });
    globalThis.localStorage.clear();
  });

  afterEach(() => {
    usePaletteStore.setState({ isOpen: false });
    vi.clearAllMocks();
  });

  it('moves with the arrows, wrapping at both ends', () => {
    renderPalette();
    type('lamp');

    expect(activeRow()).toContain('Lamp 0');

    press('ArrowUp');

    expect(activeRow()).toContain('Lamp 2');

    press('ArrowDown');

    expect(activeRow()).toContain('Lamp 0');
  });

  it('makes the first row active again after each keystroke', () => {
    renderPalette();
    type('lamp');
    press('ArrowDown');
    type('lamp 1');

    expect(activeRow()).toContain('Lamp 1');
  });

  it('goes where Enter says, and closes', () => {
    renderPalette();
    type('lamp 2');
    press('Enter');

    expect(screen.getByTestId('address').textContent).toBe('/devices?entity=light.lamp_2');
    expect(usePaletteStore.getState().isOpen).toBe(false);
  });

  it('runs the second action on Tab and stays open', async () => {
    renderPalette();
    type('sunset');
    press('Tab');

    await waitFor(() => {
      expect(vi.mocked(updateAutomation)).toHaveBeenCalledWith(AUTOMATION.id, {
        isEnabled: false,
      });
    });
    expect(usePaletteStore.getState().isOpen).toBe(true);
  });

  it('applies a scene on Enter', async () => {
    renderPalette();
    type('evening');
    press('Enter');

    await waitFor(() => {
      expect(vi.mocked(applyScene)).toHaveBeenCalledWith(SCENE.id);
    });
  });

  it('gives the focus back on Escape', () => {
    const opener = globalThis.document.createElement('button');

    globalThis.document.body.append(opener);
    opener.focus();
    renderPalette();
    fireEvent.keyDown(globalThis.document.activeElement ?? globalThis.document.body, {
      key: 'Escape',
    });

    expect(usePaletteStore.getState().isOpen).toBe(false);
    expect(globalThis.document.activeElement).toBe(opener);
    opener.remove();
  });

  it('shows a group in full from its Show all row', () => {
    renderPalette(8);
    type('lamp');

    expect(screen.getAllByRole('option')).toHaveLength(6);

    for (let step = 0; step < 5; step += 1) {
      press('ArrowDown');
    }

    expect(activeRow()).toContain('8');

    press('Enter');

    expect(screen.queryByText(/Show all/u)).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(8);
  });

  it('says nothing matched and offers the Hub', () => {
    renderPalette();
    type('zigbee');

    expect(
      screen.getByText('Nothing matches “zigbee”.', { selector: 'p:not([aria-live])' }),
    ).toBeDefined();
    expect(activeRow()).toContain('Search the Hub for “zigbee”');

    press('Enter');

    expect(screen.getByTestId('address').textContent).toBe('/integrations?hub=zigbee');
  });

  it('remembers what was opened, and drops what is gone', () => {
    globalThis.localStorage.setItem(RECENTS_KEY, JSON.stringify(['entities:light.gone']));
    const first = renderPalette();

    type('lamp 1');
    press('Enter');
    first.unmount();
    renderPalette();

    const recent = screen.getByRole('group', { name: 'Recent' });

    expect(recent.textContent).toContain('Lamp 1');
    expect(recent.textContent).not.toContain('gone');
  });

  it('closes only itself on Escape over the entity dialog', () => {
    const onDialogClose = vi.fn();

    render(
      <Modal isOpen onClose={onDialogClose} title="Island lights">
        <p>Island lights</p>
      </Modal>,
    );
    renderPalette();

    act(() => {
      fireEvent.keyDown(globalThis.document.body, { key: 'Escape' });
    });

    expect(usePaletteStore.getState().isOpen).toBe(false);
    expect(onDialogClose).not.toHaveBeenCalled();
  });
});
