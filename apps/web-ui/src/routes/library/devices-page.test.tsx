/**
 * The registry page: a device with its entities, the readings under it, and the live channel
 * changing them while the page is open.
 *
 * The API module is stood in for; the live store is the real one, fed the way the channel would
 * feed it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  entityIdSchema,
  type DeviceView,
  type EntityView,
  type IntegrationVendorView,
} from '@nebula-home/contracts';

import { useSession } from '@/auth/session-store';
import { fetchDevices, fetchEntities, fetchIcons, fetchTags, fetchVendors } from '@/library/api';
import { useLive } from '@/live/live-store';

import { DevicesPage } from './devices-page';

vi.mock('@/library/api', () => ({
  fetchDevices: vi.fn(),
  fetchEntities: vi.fn(),
  fetchVendors: vi.fn(),
  fetchIcons: vi.fn(),
  fetchTags: vi.fn(),
  createTag: vi.fn(),
  updateEntity: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    devices: ['library', 'devices'],
    entities: ['library', 'entities'],
    vendors: ['library', 'vendors'],
    icons: ['library', 'icons'],
    tags: ['library', 'tags'],
  },
}));

/** A tag the owner made, on the nozzle. */
const EXTERIOR = {
  id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
  key: 'exterior',
  name: 'Exterior',
  color: 'green',
  icon: null,
  deviceCount: 0,
  entityCount: 1,
} as const;

const NOZZLE_ID = entityIdSchema.parse('sensor.bambu_lab_p1s_nozzle_temperature');
const LIGHT_ID = entityIdSchema.parse('light.bambu_lab_p1s_chamber_light');

/** The printer, as the registry lists it. */
const PRINTER: DeviceView = {
  id: 'bambu-lab-p1s',
  name: 'Workshop printer',
  icon: 'printer',
  kind: 'bambu-lab/printer',
  kindVersion: '1.0.0',
  vendorId: 'bambu-lab',
  driverId: 'printer',
  driverName: 'Printer',
  model: 'P1S',
  transport: 'mqtt',
  transportConfig: {},
  options: {},
  isEnabled: true,
  state: 'running',
  lastError: null,
  lastStartedAt: null,
  lastUpdatedAt: null,
  externalId: '01P00A000000042',
  manufacturer: 'Bambu Lab',
  swVersion: null,
  hwVersion: null,
  areaId: null,
  areaKey: null,
  areaName: null,
  entityIds: [NOZZLE_ID, LIGHT_ID],
  tagIds: [],
};

/** A relay of another vendor, switched off. */
const RELAY: DeviceView = {
  ...PRINTER,
  id: 'shelly-garage',
  name: 'Garage relay',
  icon: 'relay',
  kind: 'shelly/1pm-mini-g3',
  vendorId: 'shelly',
  driverId: '1pm-mini-g3',
  driverName: '1PM Mini Gen3',
  model: '1PM Mini Gen3',
  transport: 'http',
  isEnabled: false,
  state: 'disabled',
  externalId: null,
  manufacturer: 'Shelly',
  areaId: null,
  areaKey: 'garage',
  areaName: 'Garage',
  entityIds: [],
  tagIds: [],
};

/** The vendors, as the catalogue lists them. */
const VENDORS: IntegrationVendorView[] = ['bambu-lab', 'shelly'].map((id) => ({
  id,
  version: '1.0.0',
  name: id === 'shelly' ? 'Shelly' : 'Bambu Lab',
  logoPadding: 0,
  internetRequired: false,
  transports: [],
  setup: { transport: { constants: {}, fields: [] }, options: { constants: {}, fields: [] } },
  drivers: [],
  needsSetup: false,
  isConfigured: false,
  transportConfig: {},
  options: {},
  configuredAt: null,
  deviceCount: 1,
  entityCount: 2,
}));

/**
 * An entity of the printer that has never reported.
 *
 * @param entityId - Its address.
 * @param name - What it is called.
 * @param overrides - What differs from a thermometer.
 * @returns The entity.
 */
function entity(
  entityId: EntityView['entityId'],
  name: string,
  overrides: Partial<EntityView> = {},
): EntityView {
  return {
    entityId,
    domain: entityId.split('.')[0] ?? '',
    name,
    icon: null,
    areaKey: null,
    areaName: null,
    deviceId: '00000000-0000-4000-8000-000000000010',
    source: 'bambu-lab-p1s',
    unitOfMeasurement: '°C',
    deviceClass: 'temperature',
    isEnabled: true,
    isHidden: false,
    capabilities: [{ capability: 'sensor_numeric', params: {} }],
    searchAliases: [],
    state: null,
    attributes: {},
    isAvailable: true,
    lastChanged: null,
    lastUpdated: null,
    tagIds: [],
    ...overrides,
  };
}

/**
 * Renders the page with an owner signed in.
 *
 * @param address - Where the page is opened, with any query string a link carried.
 */
function renderPage(address = '/devices'): void {
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: [
        { key: 'device:write', scope: '*', effect: 'allow' },
        { key: 'entity:write', scope: '*', effect: 'allow' },
        { key: 'integration:read', scope: '*', effect: 'allow' },
      ],
      avatarUrl: null,
      locale: 'it',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[address]}>
        <DevicesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useLive.getState().reset();
  vi.mocked(fetchDevices).mockResolvedValue([PRINTER, RELAY]);
  vi.mocked(fetchVendors).mockResolvedValue(VENDORS);
  vi.mocked(fetchIcons).mockResolvedValue([]);
  vi.mocked(fetchTags).mockResolvedValue([EXTERIOR]);
  vi.mocked(fetchEntities).mockResolvedValue([
    entity(NOZZLE_ID, 'Nozzle temperature', { tagIds: [EXTERIOR.id] }),
    entity(LIGHT_ID, 'Chamber light', {
      unitOfMeasurement: null,
      deviceClass: null,
      capabilities: [{ capability: 'on_off', params: {} }],
    }),
  ]);
});

describe('DevicesPage', () => {
  it('lists the device under its vendor by name, silent until something reports', async () => {
    renderPage();

    const row = await screen.findByRole('button', { name: /Workshop printer/u });

    expect(row.textContent).toContain('Bambu Lab');
    expect(row.textContent).toContain('Silent');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Registry')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add device' })).toBeNull();
  });

  it('says one word for a device that is switched off', async () => {
    renderPage();

    const row = await screen.findByRole('button', { name: /Garage relay/u });

    expect(row.textContent).toContain('disabled');
    expect(row.textContent).not.toContain('Silent');
  });

  it('opens to the entities, each by name, with its tags, its capability and its reading', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Workshop printer/u }));

    // The address is what automations name an entity by, not what a person recognises it by:
    // it is kept for the search and the dialog, and no longer printed on the row.
    expect(screen.queryByText(NOZZLE_ID)).toBeNull();
    expect(screen.getByText('Nozzle temperature').getAttribute('title')).toBe(NOZZLE_ID);
    expect(screen.getByText('Temperature')).toBeTruthy();
    expect(screen.queryByText('sensor_numeric')).toBeNull();
    expect(screen.getAllByTitle('Never reported')).toHaveLength(2);

    await waitFor(() => {
      expect(screen.getByText('Exterior')).toBeTruthy();
    });
  });

  it('draws a tag on an entity by the icon the tag was given', async () => {
    vi.mocked(fetchTags).mockResolvedValue([{ ...EXTERIOR, icon: 'sun' }]);
    vi.mocked(fetchIcons).mockImplementation((request) =>
      Promise.resolve(
        (request.ids ?? []).includes('sun')
          ? [
              {
                id: 'sun',
                name: 'Sun',
                keywords: [],
                origin: 'builtin',
                isOverridden: false,
                node: [['rect', { x: '2', y: '2', width: '20', height: '20' }]],
                frame: { x: 0, y: 0, size: 24 },
              },
            ]
          : [],
      ),
    );
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Workshop printer/u }));

    await waitFor(() => {
      expect(screen.getByTitle('Exterior').querySelector('svg rect')).toBeTruthy();
    });

    // Beside the name, on the left, as part of what the entity is called - not off to the
    // right with what it can do. And glyph-only there: a row has room for several glyphs.
    const chip = screen.getByTitle('Exterior');
    const name = screen.getByText('Nozzle temperature');

    expect(chip.parentElement).toBe(name.parentElement);
    expect(chip.className).toContain('group');
    expect(chip.querySelector('[class*="group-hover"]')).toBeTruthy();
  });

  it('opens an entity for configuring from the spanner on its row', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Workshop printer/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Configure Nozzle temperature' }));

    const dialog = screen.getByRole('dialog');

    expect(dialog.textContent).toContain('Configure Nozzle temperature');
    expect(dialog.textContent).toContain(NOZZLE_ID);
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Nozzle temperature');
  });

  it('shows what the channel delivers, and turns the device to reporting', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Workshop printer/u }));

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
      expect(screen.getByText('°C')).toBeTruthy();
    });
    expect(screen.queryByText('215 °C')).toBeNull();
    expect(screen.getByRole('button', { name: /Workshop printer/u }).textContent).toContain(
      'Reporting',
    );
  });

  it('narrows the list by what is typed, through the entities too', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Workshop printer/u });

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'chamber' } });
    expect(screen.getByRole('button', { name: /Workshop printer/u })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Garage relay/u })).toBeNull();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'nothing here' } });
    expect(screen.queryByRole('button', { name: /Workshop printer/u })).toBeNull();
    expect(screen.getByText(/Nothing matches/u)).toBeTruthy();
  });

  it('narrows the list by vendor and by area, from the filter in the header', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Workshop printer/u });

    fireEvent.click(screen.getByRole('button', { name: /Filter/u }));
    fireEvent.click(await screen.findByRole('combobox', { name: /integration/iu }));
    fireEvent.click(screen.getByRole('option', { name: 'Shelly' }));

    expect(screen.queryByRole('button', { name: /Workshop printer/u })).toBeNull();
    expect(screen.getByRole('button', { name: /Garage relay/u })).toBeTruthy();

    fireEvent.click(screen.getByRole('combobox', { name: /integration/iu }));
    fireEvent.click(screen.getByRole('option', { name: 'Any integration' }));
    fireEvent.click(screen.getByRole('combobox', { name: /^Area/u }));
    fireEvent.click(screen.getByRole('option', { name: 'Garage' }));

    expect(screen.queryByRole('button', { name: /Workshop printer/u })).toBeNull();
    expect(screen.getByRole('button', { name: /Garage relay/u })).toBeTruthy();
  });

  it('opens on one device, already expanded, when a link names it', async () => {
    // From the vendor page: the registry, narrowed to the row that was clicked.
    renderPage('/devices?device=bambu-lab-p1s');

    const row = await screen.findByRole('button', { name: /Workshop printer/u });

    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('button', { name: /Garage relay/u })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show all devices' }));

    expect(await screen.findByRole('button', { name: /Garage relay/u })).toBeTruthy();
  });
});
