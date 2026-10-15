/**
 * A device's own page: the device at a glance, the facts about it, every entity it exposes with
 * what each reads, and the settings dialog behind the button in the header.
 *
 * The API module is stood in for; the live store is the real one, fed the way the channel would
 * feed it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSession } from '@/auth/session-store';
import {
  fetchAreas,
  fetchDeviceActivity,
  fetchDevices,
  fetchEntities,
  fetchIcons,
  fetchTags,
  fetchVendors,
} from '@/library/api';
import { useLive } from '@/live/live-store';
import {
  EXTERIOR,
  NOZZLE_ID,
  PRINTER,
  printerEntities,
  RELAY,
  VENDORS,
} from '@/testing/printer-fixtures';

import { DevicePage } from './device-page';

vi.mock('@/library/api', () => ({
  fetchAreas: vi.fn(),
  fetchDeviceActivity: vi.fn(),
  fetchDevices: vi.fn(),
  fetchEntities: vi.fn(),
  fetchVendors: vi.fn(),
  fetchIcons: vi.fn(),
  fetchTags: vi.fn(),
  createTag: vi.fn(),
  updateDevice: vi.fn(),
  createDevice: vi.fn(),
  deleteDevice: vi.fn(),
  probeDevice: vi.fn(),
  commandEntity: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    activity: ['library', 'activity'],
    areas: ['library', 'areas'],
    devices: ['library', 'devices'],
    entities: ['library', 'entities'],
    vendors: ['library', 'vendors'],
    icons: ['library', 'icons'],
    tags: ['library', 'tags'],
  },
}));

/**
 * Renders a device's page with an owner signed in.
 *
 * @param deviceId - Whose page.
 * @param permissions - What the owner holds.
 */
function renderPage(
  deviceId = 'bambu-lab-p1s',
  permissions = ['device:write', 'entity:write', 'integration:read'],
): void {
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
      houseLocale: 'en',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/devices/${deviceId}`]}>
        <Routes>
          <Route path="/devices/:deviceId" element={<DevicePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useLive.getState().reset();
  vi.mocked(fetchAreas).mockResolvedValue([]);
  vi.mocked(fetchDevices).mockResolvedValue([PRINTER, RELAY]);
  vi.mocked(fetchVendors).mockResolvedValue(VENDORS);
  vi.mocked(fetchIcons).mockResolvedValue([]);
  vi.mocked(fetchTags).mockResolvedValue([EXTERIOR]);
  vi.mocked(fetchEntities).mockResolvedValue(printerEntities());
});

describe('DevicePage', () => {
  it('names the device, where it comes from and what it is, with the way back', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Workshop printer', level: 1 })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Devices' }).getAttribute('href')).toBe('/devices');
    expect(screen.getByRole('link', { name: 'Bambu Lab' }).getAttribute('href')).toBe(
      '/integrations/bambu-lab',
    );
    expect(screen.getByText('01P00A000000042')).toBeTruthy();
    // Its standing is its hero's Pill, and the Connection card of its health strip.
    expect(screen.getAllByText('Silent').length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Health' }).textContent).toContain('Connection');
  });

  it('lists its entities by name, with what each is in words, its tags and its reading', async () => {
    renderPage();

    expect(await screen.findByRole('region', { name: 'Sensors' })).toBeTruthy();
    // The address is what automations name an entity by, not what a person recognises it by.
    expect(screen.queryByText(NOZZLE_ID)).toBeNull();
    expect(screen.getByText('Nozzle temperature').getAttribute('title')).toBe(NOZZLE_ID);
    expect(screen.getByText('Temperature sensor')).toBeTruthy();
    expect(screen.getByText('Light')).toBeTruthy();
    expect(screen.queryByText('sensor_numeric')).toBeNull();
    expect(screen.getAllByTitle('Never reported')).toHaveLength(2);

    await waitFor(() => {
      expect(screen.getByText('Exterior')).toBeTruthy();
    });
  });

  it('leads from each entity to its own page', async () => {
    renderPage();

    expect(
      (await screen.findByRole('link', { name: 'Nozzle temperature' })).getAttribute('href'),
    ).toBe(`/devices/entities/${encodeURIComponent(NOZZLE_ID)}`);
  });

  it('opens an entity settings over the list from its spanner, without leaving the page', async () => {
    // The spanner used to be a link to the entity's page, which opened the settings there: the
    // dialog appeared and the list it was opened from was gone.
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Configure Nozzle temperature' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Sensors' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Configure Nozzle temperature' })).toBeNull();
  });

  it('lists what can be operated apart from what only reports, each under a heading', async () => {
    renderPage();

    const controls = await screen.findByRole('region', { name: 'Controls' });
    const sensors = screen.getByRole('region', { name: 'Sensors' });

    expect(controls.textContent).toContain('Chamber light');
    expect(controls.textContent).not.toContain('Nozzle temperature');
    expect(sensors.textContent).toContain('Nozzle temperature');
    // Controls first.
    expect(controls.compareDocumentPosition(sensors) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('links to the device web page from its header and its details', async () => {
    vi.mocked(fetchDevices).mockResolvedValue([
      { ...PRINTER, transportConfig: { host: '192.168.1.60' } },
      RELAY,
    ]);
    vi.mocked(fetchVendors).mockResolvedValue(
      VENDORS.map((vendor) =>
        vendor.id === 'bambu-lab'
          ? {
              ...vendor,
              drivers: [
                {
                  id: 'bambu-lab/printer',
                  webPagePort: 80,
                } as unknown as (typeof vendor.drivers)[number],
              ],
            }
          : vendor,
      ),
    );
    renderPage();

    const link = await screen.findByRole('link', { name: /192\.168\.1\.60/u });

    expect(link.getAttribute('href')).toBe('http://192.168.1.60/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('link', { name: 'Open its web page' }).getAttribute('href')).toBe(
      'http://192.168.1.60/',
    );
  });

  it('offers a switch on what can be switched, and holds it to the role', async () => {
    renderPage();

    // The owner here holds entity:write but not entity:control: the switch says what the light
    // is doing, and it cannot be pressed.
    const power = await screen.findByRole('switch', { name: 'Chamber light' });

    expect(power.getAttribute('aria-checked')).toBe('false');
    expect(power).toHaveProperty('disabled', true);
    expect(screen.queryByRole('switch', { name: 'Nozzle temperature' })).toBeNull();
  });

  it('shows what the channel delivers, and turns the device to reporting', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Sensors' });

    useLive.getState().apply({
      type: 'state_changed',
      entityId: NOZZLE_ID,
      state: { sensor_numeric: { value: 215 } },
      attributes: {},
      isAvailable: true,
      changedAt: new Date(),
    });

    await waitFor(() => {
      expect(screen.getByText('215')).toBeTruthy();
      expect(screen.getAllByText('Reporting').length).toBeGreaterThan(0);
    });
  });

  it('opens the settings from the header, for someone who may change the device', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('dialog').textContent).toContain('Configure Workshop printer');
  });

  it('keeps the settings from someone who may only look', async () => {
    renderPage('bambu-lab-p1s', ['integration:read']);

    await screen.findByRole('region', { name: 'Sensors' });

    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
  });

  it('says so when there is no such device', async () => {
    renderPage('no-such-device');

    expect((await screen.findByRole('alert')).textContent).toContain('no-such-device');
  });

  it('lists what changed on the device, and opens one change into what is known of it', async () => {
    vi.mocked(fetchDeviceActivity).mockResolvedValue({
      items: [
        {
          time: new Date(),
          entityId: NOZZLE_ID,
          kind: 'availability',
          from: { sensor_numeric: { value: 210 } },
          to: { sensor_numeric: { value: 210 } },
          isAvailable: false,
          wasAvailable: true,
          source: 'bambu-lab-p1s',
        },
      ],
      nextCursor: undefined,
    });
    renderPage('bambu-lab-p1s', ['device:write', 'entity:write', 'history:read']);

    // What changed on it is its own tab.
    fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
    fireEvent.click(await screen.findByRole('button', { name: /Went offline/u }));

    const dialog = screen.getByRole('dialog');

    expect(dialog.textContent).toContain('Reachable → Unreachable');
    expect(dialog.textContent).toContain('bambu-lab-p1s');
  });

  it('shows no activity to someone who may not read the past', async () => {
    vi.mocked(fetchDeviceActivity).mockClear();
    renderPage();

    await screen.findByRole('region', { name: 'Sensors' });

    expect(screen.queryByRole('tab', { name: 'Activity' })).toBeNull();
    expect(fetchDeviceActivity).not.toHaveBeenCalled();
  });
});
