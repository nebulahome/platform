/**
 * One vendor's page: who they are, whether they still need setting up, and the devices added
 * under them.
 *
 * The API module is stood in for. What is asserted is what the page shows for one vendor and
 * its instances, and which dialog each button opens.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  entityIdSchema,
  type DeviceView,
  type DiscoveredDevice,
  type IntegrationVendorView,
} from '@nebula-home/contracts';

import { useSession } from '@/auth/session-store';
import { fetchDevices, fetchDiscovered, fetchIcons, fetchVendor, scanNetwork } from '@/library/api';

import { VendorPage } from './vendor-page';

vi.mock('@/library/api', () => ({
  fetchVendor: vi.fn(),
  fetchDevices: vi.fn(),
  fetchDiscovered: vi.fn(() => Promise.resolve([])),
  scanNetwork: vi.fn(),
  adoptDiscovered: vi.fn(),
  fetchAreas: vi.fn(() => Promise.resolve([])),
  fetchIcons: vi.fn(),
  createDevice: vi.fn(),
  updateDevice: vi.fn(),
  probeDevice: vi.fn(),
  deleteDevice: vi.fn(),
  updateVendorConfig: vi.fn(),
  fetchTags: vi.fn(() => Promise.resolve([])),
  createTag: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    vendors: ['library', 'vendors'],
    devices: ['library', 'devices'],
    entities: ['library', 'entities'],
    icons: ['library', 'icons'],
    tags: ['library', 'tags'],
    discovered: ['library', 'discovered'],
    areas: ['library', 'areas'],
  },
}));

/** A printer the hub found on the network and nobody has added. */
const FOUND: DiscoveredDevice = {
  id: 'fedcba9876543210',
  vendorId: 'bambu-lab',
  driverId: 'printer',
  kind: 'bambu-lab/printer',
  source: 'module',
  address: '192.168.1.62',
  externalId: '01P00A000000099',
  name: 'Loft printer',
  model: 'P1S',
  modelChoices: ['P1S'],
  modelCode: 'C12',
  swVersion: null,
  transportConfig: { url: 'mqtts://192.168.1.62:8883' },
  firstSeenAt: new Date('2026-09-23T10:00:00.000Z'),
  lastSeenAt: new Date('2026-09-23T10:05:00.000Z'),
};

/** Bambu Lab, as the vendor route serves it. */
const BAMBU: IntegrationVendorView = {
  id: 'bambu-lab',
  version: '1.0.0',
  name: 'Bambu Lab',
  description: 'Printers in LAN mode, over the broker each one runs itself.',
  url: 'https://bambulab.com',
  color: '#00AE42',
  logoPadding: 0,
  internetRequired: false,
  transports: ['mqtt'],
  discoverySources: [],
  setup: { transport: { constants: {}, fields: [] }, options: { constants: {}, fields: [] } },
  drivers: [
    {
      id: 'bambu-lab/printer',
      vendorId: 'bambu-lab',
      driverId: 'printer',
      name: 'Printer',
      transport: 'mqtt',
      models: ['X1C', 'P1S'],
      setup: {
        transport: {
          constants: {},
          fields: [
            {
              key: 'url',
              type: 'text',
              label: 'Printer address',
              isRequired: true,
              maxLength: 512,
            },
          ],
        },
        options: { constants: {}, fields: [] },
      },
    },
  ],
  needsSetup: false,
  isConfigured: false,
  transportConfig: {},
  options: {},
  configuredAt: null,
  deviceCount: 0,
  entityCount: 12,
};

/** A cloud vendor that asks for a key nobody has given. */
const ACME: IntegrationVendorView = {
  ...BAMBU,
  id: 'acme',
  name: 'ACME',
  internetRequired: true,
  setup: {
    transport: {
      constants: {},
      fields: [
        { key: 'apiKey', type: 'secret', label: 'API key', isRequired: true, maxLength: 512 },
      ],
    },
    options: { constants: {}, fields: [] },
  },
  needsSetup: true,
  entityCount: 0,
};

/**
 * A device of the printer driver.
 *
 * @param overrides - What differs from a running X1C.
 * @returns The device.
 */
function device(overrides: Partial<DeviceView>): DeviceView {
  return {
    id: 'bambu-lab-x1c',
    name: 'Studio printer',
    icon: 'printer',
    kind: 'bambu-lab/printer',
    origin: 'integration',
    kindVersion: '1.0.0',
    vendorId: 'bambu-lab',
    driverId: 'printer',
    driverName: 'Printer',
    model: 'X1C',
    transport: 'mqtt',
    transportConfig: { url: 'mqtts://192.168.1.60:8883' },
    options: {},
    isEnabled: true,
    state: 'running',
    lastError: null,
    lastStartedAt: null,
    lastUpdatedAt: new Date(Date.now() - 5 * 60_000),
    externalId: '01P00A000000042',
    manufacturer: 'Bambu Lab',
    swVersion: null,
    hwVersion: null,
    areaId: null,
    areaKey: null,
    areaName: null,
    entityIds: [entityIdSchema.parse('sensor.bambu_lab_x1c_nozzle_temperature')],
    tagIds: [],
    ...overrides,
  };
}

beforeAll(() => {
  vi.mocked(fetchIcons).mockResolvedValue([]);
});

/**
 * Renders the page for one vendor with an owner signed in.
 *
 * @param vendorId - Which vendor the address names.
 * @param extra - Permissions held beside configuring and adding devices.
 */
function renderPage(vendorId: string, extra: readonly string[] = []): void {
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: [
        { key: 'integration:configure', scope: '*', effect: 'allow' },
        { key: 'device:write', scope: '*', effect: 'allow' },
        ...extra.map((key) => ({ key, scope: '*', effect: 'allow' as const })),
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
      <MemoryRouter initialEntries={[`/integrations/${vendorId}`]}>
        <Routes>
          <Route path="/integrations/:vendorId" element={<VendorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('a vendor page', () => {
  it('says who the vendor is, and lists each device by its name, with the model, its state and when it last reported', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(BAMBU);
    vi.mocked(fetchDevices).mockResolvedValue([
      device({}),
      device({
        id: 'bambu-lab-p1s',
        name: 'Garage printer',
        model: 'P1S',
        state: 'failed',
        lastError: 'mqtts://192.168.1.61:8883 did not answer: ECONNREFUSED',
        lastUpdatedAt: null,
      }),
    ]);
    renderPage('bambu-lab');

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Bambu Lab');
    });
    expect(
      screen.getByText('Printers in LAN mode, over the broker each one runs itself.'),
    ).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Listens on the MQTT broker' })).toBeTruthy();

    const rows = screen.getAllByRole('listitem');

    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Studio printer'),
      expect.stringContaining('Garage printer'),
    ]);
    expect(rows[0]?.textContent).toContain('X1C');
    expect(rows[0]?.textContent).toMatch(/5 (?:minutes ago|minuti fa)/u);
    expect(rows[1]?.textContent).toContain('failed');
    expect(rows[1]?.textContent).toContain('ECONNREFUSED');
    expect(rows[1]?.textContent).toContain('—');

    // The name is the way to the registry: the devices page, narrowed to this one device.
    expect(screen.getByRole('link', { name: 'Studio printer' }).getAttribute('href')).toBe(
      '/devices/bambu-lab-x1c',
    );
  });

  it('shows one word for a device that is switched off, and a spanner to configure it', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(BAMBU);
    vi.mocked(fetchDevices).mockResolvedValue([
      device({ isEnabled: false, state: 'disabled', lastUpdatedAt: null }),
    ]);
    renderPage('bambu-lab');

    await waitFor(() => {
      expect(screen.getByRole('listitem').textContent).toContain('disabled');
    });
    expect(screen.getByRole('listitem').textContent).not.toMatch(/\bOff\b/u);
    expect(screen.queryByText(/Add device connects/u)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Configure Studio printer' }));

    expect(screen.getByRole('dialog').textContent).toContain('Configure Studio printer');
  });

  it('separates the id, the version and the site with dots', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(BAMBU);
    vi.mocked(fetchDevices).mockResolvedValue([]);
    renderPage('bambu-lab');

    await waitFor(() => {
      expect(screen.getByText('bambulab.com')).toBeTruthy();
    });

    const meta = screen.getByText('bambulab.com').closest('div');

    expect(meta?.textContent).toMatch(/bambu-lab\s*·\s*v1\.0\.0\s*·\s*bambulab\.com/u);
  });

  it('opens the add-device dialog with the vendor, offering its models', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(BAMBU);
    vi.mocked(fetchDevices).mockResolvedValue([]);
    renderPage('bambu-lab');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add device' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add device' }));

    expect(screen.getByRole('dialog').textContent).toContain('Add a device');
    expect(screen.getByLabelText('Model').textContent).toContain('X1C');
  });

  it('holds back Add device until a vendor that asks for something has been set up', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(ACME);
    vi.mocked(fetchDevices).mockResolvedValue([]);
    renderPage('acme');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add device' })).toBeTruthy();
    });

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add device' }).disabled).toBe(
      true,
    );
    expect(screen.getByRole('status').textContent).toContain('needs setting up');
  });

  it('opens the vendor form from Configure, with what the vendor asks', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(ACME);
    vi.mocked(fetchDevices).mockResolvedValue([]);
    renderPage('acme');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Configure' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));

    expect(screen.getByRole('dialog').textContent).toContain('Set up ACME');
    expect(screen.getByLabelText('API key')).toBeTruthy();
  });

  it('has no Configure for a vendor that asks for nothing, and keeps Remove for later', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(BAMBU);
    vi.mocked(fetchDevices).mockResolvedValue([]);
    renderPage('bambu-lab');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    });

    expect(screen.queryByRole('button', { name: 'Configure' })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove' }).disabled).toBe(true);
  });
});

describe('the devices of a vendor found on the network', () => {
  it('are shown between the vendor and its devices, set apart, each with an Adopt', async () => {
    vi.mocked(fetchVendor).mockResolvedValue({ ...BAMBU, discoverySources: ['module'] });
    vi.mocked(fetchDevices).mockResolvedValue([device({})]);
    vi.mocked(fetchDiscovered).mockResolvedValue([FOUND]);
    renderPage('bambu-lab', ['device:read']);

    const found = await screen.findByRole('region', { name: /Found on your network/u });

    expect(found.textContent).toContain('Loft printer');
    fireEvent.click(screen.getByRole('button', { name: 'Adopt Loft printer' }));
    expect(await screen.findByRole('dialog', { name: 'Adopt Loft printer' })).toBeTruthy();
  });

  it('draw nothing when nothing of the vendor was found', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(BAMBU);
    vi.mocked(fetchDevices).mockResolvedValue([device({})]);
    vi.mocked(fetchDiscovered).mockResolvedValue([{ ...FOUND, vendorId: 'shelly' }]);
    renderPage('bambu-lab', ['device:read']);

    await screen.findByText('Studio printer');

    expect(screen.queryByRole('region', { name: /Found on your network/u })).toBeNull();
  });

  it('can be looked for now, for a vendor whose devices can be found', async () => {
    vi.mocked(fetchVendor).mockResolvedValue({ ...BAMBU, discoverySources: ['module'] });
    vi.mocked(fetchDevices).mockResolvedValue([]);
    vi.mocked(scanNetwork).mockResolvedValue(['bambu-lab']);
    renderPage('bambu-lab', ['device:read']);

    fireEvent.click(await screen.findByRole('button', { name: 'Discover devices' }));

    await waitFor(() => {
      expect(scanNetwork).toHaveBeenCalledWith('bambu-lab');
    });
  });

  it('offer no Discover for a vendor whose devices are only added by address', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(BAMBU);
    vi.mocked(fetchDevices).mockResolvedValue([]);
    renderPage('bambu-lab', ['device:read']);

    await screen.findByRole('heading', { name: 'Bambu Lab', level: 2 });

    expect(screen.queryByRole('button', { name: 'Discover devices' })).toBeNull();
  });
});
