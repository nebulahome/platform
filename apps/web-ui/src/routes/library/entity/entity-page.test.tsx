/**
 * An entity's page: the controls it draws for what the entity declares, the commands they send,
 * and the settings dialog behind the button in its header.
 *
 * The API module is stood in for; the session and the live store are the real ones.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntityView } from '@nebula-home/contracts';

import { useSession } from '@/auth/session-store';
import {
  commandEntity,
  fetchAliases,
  fetchAreas,
  fetchAutomations,
  fetchDevices,
  fetchEntity,
  fetchIcons,
  fetchScenes,
  fetchStateHistory,
  fetchTags,
  fetchTelemetry,
  fetchVendors,
} from '@/library/api';
import { useLive } from '@/live/live-store';
import { aDevice, anArea, anEntity } from '@/testing/fixtures';

import { EntityPage } from './entity-page';

vi.mock('@/library/api', () => ({
  commandEntity: vi.fn(),
  fetchAliases: vi.fn(),
  fetchAutomations: vi.fn(),
  fetchScenes: vi.fn(),
  fetchAreas: vi.fn(),
  fetchDevices: vi.fn(),
  fetchEntity: vi.fn(),
  fetchIcons: vi.fn(),
  fetchStateHistory: vi.fn(),
  fetchTags: vi.fn(),
  fetchTelemetry: vi.fn(),
  fetchVendors: vi.fn(),
  createTag: vi.fn(),
  updateEntity: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    aliases: ['library', 'aliases'],
    automations: ['library', 'automations'],
    scenes: ['library', 'scenes'],
    areas: ['library', 'areas'],
    devices: ['library', 'devices'],
    entities: ['library', 'entities'],
    history: ['library', 'history'],
    icons: ['library', 'icons'],
    tags: ['library', 'tags'],
    vendors: ['library', 'vendors'],
  },
}));

/** A tunable-white desk lamp, on at 40%, in the study on the first floor. */
const LAMP: EntityView = anEntity({
  entityId: 'light.desk_lamp',
  name: 'Desk lamp',
  source: 'govee-desk',
  areaKey: 'study',
  areaName: 'Study',
  capabilities: [
    { capability: 'on_off', params: {} },
    { capability: 'level', params: {} },
    { capability: 'color_temp', params: { minMireds: 153, maxMireds: 370 } },
  ],
  state: { on_off: { isOn: true }, level: { level: 40 }, color_temp: { mireds: 370 } },
});

/**
 * Renders an entity's page, with a person who holds the given permissions.
 *
 * @param entity - The entity the API answers with.
 * @param permissions - The keys granted everywhere.
 * @param address - Where the page opens.
 */
function renderPage(
  entity: EntityView,
  permissions: readonly string[] = ['entity:read', 'entity:write', 'entity:control'],
  address = `/devices/entities/${entity.entityId}`,
): void {
  vi.mocked(fetchEntity).mockResolvedValue(entity);
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: permissions.map((key) => ({ key, scope: '*', effect: 'allow' as const })),
      avatarUrl: null,
      locale: 'it',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[address]}>
        <Routes>
          <Route path="/devices/entities/:entityId" element={<EntityPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useLive.getState().reset();
  vi.mocked(commandEntity).mockResolvedValue({
    entityId: LAMP.entityId,
    capability: 'on_off',
    acceptedAt: new Date(),
    idempotencyKey: 'key',
  });
  vi.mocked(fetchDevices).mockResolvedValue([
    aDevice({ id: 'govee-desk', name: 'Desk light', vendorId: 'govee' }),
  ]);
  vi.mocked(fetchVendors).mockResolvedValue([]);
  vi.mocked(fetchIcons).mockResolvedValue([]);
  vi.mocked(fetchTags).mockResolvedValue([]);
  vi.mocked(fetchAreas).mockResolvedValue([
    anArea('home', 'house', null),
    anArea('first_floor', 'floor', 'home'),
    anArea('study', 'room', 'first_floor'),
  ]);
  vi.mocked(fetchStateHistory).mockResolvedValue([]);
  vi.mocked(fetchTelemetry).mockResolvedValue([]);
});

describe('EntityPage', () => {
  it('names where the entity is, and what it is', async () => {
    renderPage(LAMP);

    expect(await screen.findByRole('heading', { name: 'Desk lamp', level: 2 })).toBeTruthy();
    expect(screen.getAllByText('Tunable white light').length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getAllByText(/First floor › Study/u).length).toBeGreaterThan(0);
    });
    expect(screen.getByText('light.desk_lamp')).toBeTruthy();
  });

  it('draws a control for each capability the lamp declares, and no other', async () => {
    renderPage(LAMP);

    expect(await screen.findByRole('switch', { name: 'Desk lamp power' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Brightness' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Colour temperature' })).toBeTruthy();
    expect(screen.queryByRole('slider', { name: 'Colour' })).toBeNull();
    expect(screen.queryByText('Cover')).toBeNull();
  });

  it('switches explicitly, never by toggling', async () => {
    renderPage(LAMP);

    fireEvent.click(await screen.findByRole('switch', { name: 'Desk lamp power' }));

    await waitFor(() => {
      expect(commandEntity).toHaveBeenCalledWith('light.desk_lamp', 'on_off', {
        command: 'turn_off',
      });
    });
  });

  it('sets the brightness when the slider is let go, not while it moves', async () => {
    renderPage(LAMP);

    const brightness = await screen.findByRole('slider', { name: 'Brightness' });

    fireEvent.input(brightness, { target: { value: '75' } });
    expect(commandEntity).not.toHaveBeenCalled();
    expect(brightness.getAttribute('aria-valuetext')).toBe('75%');

    brightness.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => {
      expect(commandEntity).toHaveBeenCalledWith('light.desk_lamp', 'level', {
        command: 'set_level',
        level: 75,
      });
    });
  });

  it('sets the white in mireds, from a preset held inside the lamp’s range', async () => {
    renderPage(LAMP);

    // The lamp goes from 2700 K to 6540 K; "Warm" is 2700 K, which it can just reach.
    fireEvent.click(await screen.findByRole('button', { name: /^Warm/u }));

    await waitFor(() => {
      expect(commandEntity).toHaveBeenCalledWith('light.desk_lamp', 'color_temp', {
        command: 'set_color_temp',
        mireds: 370,
      });
    });
  });

  it('turns a colour lamp white at once when a white is chosen', async () => {
    renderPage(
      anEntity({
        ...LAMP,
        capabilities: [...LAMP.capabilities, { capability: 'color_hs', params: {} }],
        state: { ...LAMP.state, color_hs: { hue: 280, saturation: 90 } },
      }),
    );

    expect(await screen.findByText('280° · 90%')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: /^Daylight/u }));

    expect(await screen.findByText('280° · 0%')).toBeTruthy();
    expect(commandEntity).toHaveBeenCalledWith('light.desk_lamp', 'color_temp', {
      command: 'set_color_temp',
      mireds: 154,
    });
    expect(commandEntity).not.toHaveBeenCalledWith(
      'light.desk_lamp',
      'color_hs',
      expect.anything(),
    );
  });

  it('keeps the controls but refuses them to someone who may only look, and says why', async () => {
    renderPage(LAMP, ['entity:read']);

    const power = await screen.findByRole('switch', { name: 'Desk lamp power' });

    expect(power).toHaveProperty('disabled', true);
    expect(screen.getByText(/your role does not let you control it/u)).toBeTruthy();
  });

  it('reads a sensor large, and draws its past from its telemetry', async () => {
    const power = anEntity({
      entityId: 'sensor.plug_power',
      name: 'Plug power',
      deviceClass: 'power',
      unitOfMeasurement: 'W',
      capabilities: [{ capability: 'sensor_numeric', params: {} }],
      state: { sensor_numeric: { value: 42.5 } },
    });

    renderPage(power);

    expect((await screen.findAllByText('Power sensor')).length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Power' }).textContent).toContain('W');
    await waitFor(() => {
      expect(fetchTelemetry).toHaveBeenCalled();
    });
    expect(fetchStateHistory).not.toHaveBeenCalled();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('opens its settings in a dialog from the button in the header, and has no views to switch', async () => {
    renderPage(LAMP);

    fireEvent.click(await screen.findByRole('button', { name: 'Configure Desk lamp' }));

    const dialog = screen.getByRole('dialog');

    expect(dialog.textContent).toContain('Configure Desk lamp');
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Desk lamp');
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Views of this entity' })).toBeNull();
  });

  it('opens with the settings dialog open when the address asks for it', async () => {
    renderPage(LAMP, undefined, `/devices/entities/${LAMP.entityId}?settings=1`);

    expect((await screen.findByLabelText<HTMLInputElement>('Name')).value).toBe('Desk lamp');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('leads back to the device’s own page from the header', async () => {
    renderPage(LAMP);

    const links = await screen.findAllByRole('link', { name: 'Desk light' });

    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/devices/govee-desk',
      '/devices/govee-desk',
    ]);
  });

  it('lists what names the entity, each the way to it, for someone who may read them', async () => {
    vi.mocked(fetchAutomations).mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-0000000000a1',
        key: 'desk_at_dusk',
        name: 'Desk at dusk',
        description: '',
        definition: {
          triggers: { type: 'manual' },
          then: [
            { type: 'command', entityId: 'light.desk_lamp', capability: 'on_off', params: {} },
          ],
        },
        definitionVersion: 1,
        mode: 'single',
        maxRuntimeMs: 300_000,
        isEnabled: true,
        lastTriggeredAt: null,
      },
    ]);
    vi.mocked(fetchScenes).mockResolvedValue([]);
    vi.mocked(fetchAliases).mockResolvedValue([]);
    renderPage(LAMP, ['entity:read', 'automation:read', 'scene:read', 'alias:read']);

    const link = await screen.findByRole('link', { name: 'Desk at dusk' });

    expect(link.getAttribute('href')).toBe('/automations/00000000-0000-4000-8000-0000000000a1');
    expect(screen.getByText('Commanded')).toBeTruthy();
  });

  it('says so when nothing names the entity', async () => {
    vi.mocked(fetchAutomations).mockResolvedValue([]);
    vi.mocked(fetchScenes).mockResolvedValue([]);
    vi.mocked(fetchAliases).mockResolvedValue([]);
    renderPage(LAMP, ['entity:read', 'automation:read', 'scene:read', 'alias:read']);

    expect(await screen.findByText('Not used by any automation, scene or alias.')).toBeTruthy();
  });
});
