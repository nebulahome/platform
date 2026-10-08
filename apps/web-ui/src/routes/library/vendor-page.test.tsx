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
  entityCommandResponseSchema,
  entityIdSchema,
  entityViewSchema,
  type DeviceView,
  type EntityView,
  type DiscoveredDevice,
  type IntegrationVendorView,
} from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import {
  commandEntity,
  fetchDevices,
  fetchDiscovered,
  fetchEntity,
  fetchIcons,
  fetchVendor,
  scanNetwork,
} from '@/library/api';
import { removeIntegration } from '@/library/integration-catalogue-api';

import { VendorPage } from './vendor-page';

vi.mock('@/library/integration-catalogue-api', () => ({
  installIntegration: vi.fn(),
  removeIntegration: vi.fn(),
  INTEGRATION_CATALOGUE_KEYS: { all: ['integrations', 'catalogue'] },
}));

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
  fetchEntity: vi.fn(),
  commandEntity: vi.fn(),
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
  movedFrom: null,
  adoption: 'owner',
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
  origin: 'development',
  install: null,
  hasCode: false,
  logoPadding: 0,
  internetRequired: false,
  transports: ['mqtt'],
  wires: ['mqtt'],
  discoverySources: [],
  adoption: 'owner',
  pairing: null,
  listener: null,
  passedOver: [],
  requires: { packages: {}, services: [] },
  packageProblems: [],
  account: null,
  accounts: [],
  needsAccount: false,
  needsPackage: false,
  update: null,
  containers: [],
  containerStatuses: [],
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
    series: null,
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
 * @param tab - The tab the address opens; the overview when blank.
 */
function renderPage(vendorId: string, extra: readonly string[] = [], tab = ''): void {
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
      <MemoryRouter
        initialEntries={[`/integrations/${vendorId}${tab === '' ? '' : `?tab=${tab}`}`]}
      >
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
    renderPage('bambu-lab', [], 'devices');

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Bambu Lab');
    });
    expect(
      screen.getByText('Printers in LAN mode, over the broker each one runs itself.'),
    ).toBeTruthy();
    // The wire it speaks is a fact of its hero, beside its version.
    expect(screen.getByText('MQTT')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Devices/u }).getAttribute('aria-selected')).toBe(
      'true',
    );

    const rows = screen.getAllByRole('listitem');

    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Studio printer'),
      expect.stringContaining('Garage printer'),
    ]);
    expect(rows[0]?.textContent).toContain('X1C');
    expect(rows[0]?.textContent).toMatch(/5 (?:minutes ago|minuti fa)/u);
    expect(rows[1]?.textContent).toContain('failed');
    // One line in the list; the message itself, however long, is on the device's page.
    expect(rows[1]?.textContent).toContain('Not working - see why');
    expect(rows[1]?.textContent).not.toContain('ECONNREFUSED');
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
    renderPage('bambu-lab', [], 'devices');

    await waitFor(() => {
      expect(screen.getByRole('listitem').textContent).toContain('disabled');
    });
    expect(screen.getByRole('listitem').textContent).not.toMatch(/\bOff\b/u);
    expect(screen.queryByText(/Add device connects/u)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Configure Studio printer' }));

    expect(screen.getByRole('dialog').textContent).toContain('Configure Studio printer');
  });

  it('says what the vendor is under About: its id, its version, its site', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(BAMBU);
    vi.mocked(fetchDevices).mockResolvedValue([]);
    renderPage('bambu-lab');

    const site = await screen.findByRole('link', { name: 'bambulab.com' });
    const about = site.closest('dl');

    expect(about?.textContent).toContain('bambu-lab');
    expect(about?.textContent).toContain('1.0.0');
  });

  it('opens with the health strip: how it runs, connects, its devices and its updates', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(BAMBU);
    vi.mocked(fetchDevices).mockResolvedValue([device({})]);
    renderPage('bambu-lab');

    const strip = await screen.findByRole('region', { name: 'Health' });

    expect(strip.textContent).toContain('Runtime');
    expect(strip.textContent).toContain('Running');
    expect(strip.textContent).toContain('1 of 1 reporting');
    expect(strip.textContent).toContain('Updated by rebuilding it');
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

  it('holds back Add device while a package the vendor needs does not run, saying which', async () => {
    vi.mocked(fetchVendor).mockResolvedValue({
      ...BAMBU,
      requires: { packages: { mqtt: '^1.0.0' }, services: [] },
      packageProblems: ['Bambu Lab needs the MQTT package, which is not running'],
      needsPackage: true,
    });
    vi.mocked(fetchDevices).mockResolvedValue([]);
    renderPage('bambu-lab');

    expect(
      await screen.findByText('Bambu Lab needs the MQTT package, which is not running'),
    ).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add device' }).disabled).toBe(
      true,
    );
    // The way to the package is what the page is for until it runs.
    expect(screen.getByRole('button', { name: 'Open mqtt' })).toBeTruthy();
  });

  it('opens the vendor form from Settings, on its own tab, with what the vendor asks', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(ACME);
    vi.mocked(fetchDevices).mockResolvedValue([]);
    renderPage('acme');

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('tab', { name: 'Configuration' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByLabelText('API key')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('has no Settings for a vendor that asks for nothing', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(BAMBU);
    vi.mocked(fetchDevices).mockResolvedValue([]);
    renderPage('bambu-lab');

    await screen.findByRole('heading', { level: 1, name: 'Bambu Lab' });

    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Configuration' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('says a vendor under development is, and offers no Remove for it', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(BAMBU);
    vi.mocked(fetchDevices).mockResolvedValue([]);
    renderPage('bambu-lab', ['integration:install']);

    expect((await screen.findAllByText('In development')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('removes an installed vendor after saying what goes with it, and offers its update', async () => {
    vi.mocked(fetchVendor).mockResolvedValue({
      ...BAMBU,
      origin: 'installed',
      update: { latestVersion: '2.0.0', hasUpdate: true, hasNewBuild: false },
    });
    vi.mocked(fetchDevices).mockResolvedValue([device({})]);
    vi.mocked(removeIntegration).mockResolvedValue({
      devices: 1,
      accounts: 0,
      isRestartNeeded: false,
    });
    renderPage('bambu-lab', ['integration:install']);

    // The Updates card offers it, and so does the menu.
    expect(await screen.findByRole('button', { name: 'Update' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Update to 2.0.0' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));

    const confirm = await screen.findByRole('dialog', { name: 'Remove Bambu Lab?' });

    expect(confirm.textContent).toContain('1 device, and every entity they have');

    fireEvent.click(screen.getByRole('button', { name: 'Remove Bambu Lab' }));

    await waitFor(() => {
      expect(removeIntegration).toHaveBeenCalledWith('bambu-lab');
    });
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

  it('can be looked for now, and says what the search found', async () => {
    vi.mocked(fetchVendor).mockResolvedValue({ ...BAMBU, discoverySources: ['module'] });
    vi.mocked(fetchDevices).mockResolvedValue([]);
    vi.mocked(fetchDiscovered).mockResolvedValueOnce([]).mockResolvedValue([FOUND]);
    vi.mocked(scanNetwork).mockResolvedValue({ vendors: ['bambu-lab'], lookingForMs: 20 });
    renderPage('bambu-lab', ['device:read']);

    fireEvent.click(await screen.findByRole('button', { name: 'Discover devices' }));

    await waitFor(() => {
      expect(scanNetwork).toHaveBeenCalledWith('bambu-lab');
    });
    expect(await screen.findByText('Found 1 new Bambu Lab device.')).toBeTruthy();
  });

  it('says so when the hub is not looking', async () => {
    // A hub with discovery switched off answers at once with nothing: the button must not look
    // busy for a while and then say nothing.
    vi.mocked(fetchVendor).mockResolvedValue({ ...BAMBU, discoverySources: ['module'] });
    vi.mocked(fetchDevices).mockResolvedValue([]);
    vi.mocked(scanNetwork).mockResolvedValue({ vendors: [], lookingForMs: 0 });
    renderPage('bambu-lab', ['device:read']);

    fireEvent.click(await screen.findByRole('button', { name: 'Discover devices' }));

    expect(await screen.findByText(/discovery is switched off/u)).toBeTruthy();
  });

  it('offer no Discover for a vendor whose devices are only added by address', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(BAMBU);
    vi.mocked(fetchDevices).mockResolvedValue([]);
    renderPage('bambu-lab', ['device:read']);

    await screen.findByRole('heading', { name: 'Bambu Lab', level: 1 });

    expect(screen.queryByRole('button', { name: 'Discover devices' })).toBeNull();
  });
});

describe('a vendor that adds its own devices', () => {
  /** Zigbee2MQTT: devices come by pairing, through the bridge's buttons and its state. */
  const ZIGBEE: IntegrationVendorView = {
    ...BAMBU,
    id: 'zigbee2mqtt',
    name: 'Zigbee2MQTT',
    discoverySources: ['module'],
    adoption: 'automatic',
    pairing: {
      driverId: 'bridge',
      openObjectId: 'permit_join',
      closeObjectId: 'permit_join_stop',
      stateObjectId: 'pairing',
    },
    listener: null,
    passedOver: [],
    requires: { packages: {}, services: [] },
    packageProblems: [],
    account: null,
    accounts: [],
    needsAccount: false,
    needsPackage: false,
    update: null,
  };

  /**
   * The bridge's pairing sensor, as last reported.
   *
   * @param isOpen - Whether pairing is open.
   * @param endsAt - When the bridge said it closes, while it is open.
   * @returns The entity.
   */
  function pairingSensor(isOpen: boolean, endsAt?: string): EntityView {
    return entityViewSchema.parse({
      entityId: 'sensor.zigbee2mqtt_pairing',
      domain: 'sensor',
      name: 'Pairing',
      icon: 'link',
      areaKey: null,
      areaName: null,
      deviceId: null,
      source: 'zigbee2mqtt',
      unitOfMeasurement: null,
      deviceClass: null,
      isEnabled: true,
      isHidden: false,
      capabilities: [{ capability: 'sensor_text' }],
      state: { sensor_text: { value: isOpen ? 'enabled' : 'disabled' } },
      attributes: endsAt === undefined ? {} : { endsAt },
      isAvailable: true,
      lastChanged: null,
      lastUpdated: null,
    });
  }

  /** The bridge, added on its own. */
  const BRIDGE = device({
    id: 'zigbee2mqtt',
    name: 'Zigbee2MQTT',
    kind: 'zigbee2mqtt/bridge',
    vendorId: 'zigbee2mqtt',
    driverId: 'bridge',
    model: 'Bridge',
  });

  it('offers no Add device and nothing to look for, only pairing', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(ZIGBEE);
    vi.mocked(fetchDevices).mockResolvedValue([]);
    renderPage('zigbee2mqtt', ['device:read', 'entity:control']);

    expect(await screen.findByText(/is added here on its own/u)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add device' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discover devices' })).toBeNull();
    // Until the bridge is added there is no button to press.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Pair devices' }).disabled).toBe(
      true,
    );
    // And why, in the page rather than only in a tooltip.
    expect(screen.getByText(/Pairing is not available yet/u)).toBeTruthy();
  });

  it("opens pairing with the bridge's button, whatever the page saw last", async () => {
    vi.mocked(fetchVendor).mockResolvedValue(ZIGBEE);
    vi.mocked(fetchDevices).mockResolvedValue([BRIDGE]);
    vi.mocked(fetchEntity).mockResolvedValue(pairingSensor(false));
    vi.mocked(commandEntity).mockResolvedValue(
      entityCommandResponseSchema.parse({
        entityId: 'button.zigbee2mqtt_permit_join',
        capability: 'button',
        acceptedAt: '2026-09-28T10:00:00.000Z',
        idempotencyKey: null,
      }),
    );
    renderPage('zigbee2mqtt', ['device:read', 'entity:control']);

    const button = await screen.findByRole<HTMLButtonElement>('button', { name: 'Pair devices' });

    await waitFor(() => {
      expect(button.disabled).toBe(false);
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(commandEntity).toHaveBeenCalledWith('button.zigbee2mqtt_permit_join', 'button', {
        command: 'press',
      });
    });
  });

  it('shows pairing opened elsewhere as open, counting down to when the bridge closes it', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(ZIGBEE);
    vi.mocked(fetchDevices).mockResolvedValue([BRIDGE]);
    vi.mocked(fetchEntity).mockResolvedValue(
      pairingSensor(true, new Date(Date.now() + 125_000).toISOString()),
    );
    vi.mocked(commandEntity).mockResolvedValue(
      entityCommandResponseSchema.parse({
        entityId: 'button.zigbee2mqtt_permit_join_stop',
        capability: 'button',
        acceptedAt: '2026-09-28T10:00:00.000Z',
        idempotencyKey: null,
      }),
    );
    renderPage('zigbee2mqtt', ['device:read', 'entity:control']);

    const stop = await screen.findByRole('button', { name: /Stop/u });

    expect(screen.getByText(/Put the device in pairing mode now/u)).toBeTruthy();
    expect(screen.getByText('No device has joined yet.')).toBeTruthy();
    expect(await screen.findByText(/Closes in 2:0[45]/u)).toBeTruthy();

    fireEvent.click(stop);

    await waitFor(() => {
      expect(commandEntity).toHaveBeenCalledWith('button.zigbee2mqtt_permit_join_stop', 'button', {
        command: 'press',
      });
    });
  });

  it('says so when Zigbee2MQTT is not heard on the broker, with the way to its log', async () => {
    vi.mocked(fetchVendor).mockResolvedValue({
      ...ZIGBEE,
      listener: {
        level: 'warning',
        message:
          'NebulaHome is connected to its MQTT broker at mqtt://nebulahome:1884 but has heard nothing',
        at: new Date('2026-09-28T10:00:00.000Z'),
      },
      containerStatuses: [
        {
          ownerKind: 'vendor',
          vendorId: 'zigbee2mqtt',
          dependencyId: 'zigbee2mqtt',
          containerName: 'nebulahome-zigbee2mqtt',
          state: 'running',
          version: '2.14.1',
          error: null,
        },
      ],
    });
    vi.mocked(fetchDevices).mockResolvedValue([]);
    renderPage('zigbee2mqtt', ['device:read', 'entity:control']);

    expect(await screen.findByText('Nothing heard from Zigbee2MQTT yet')).toBeTruthy();
    expect(screen.getByText(/mqtt:\/\/nebulahome:1884/u)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open its log' }).getAttribute('href')).toBe(
      '/containers/nebulahome-zigbee2mqtt',
    );
  });

  it('lists the devices heard and not added, with why', async () => {
    vi.mocked(fetchVendor).mockResolvedValue({
      ...ZIGBEE,
      passedOver: [
        {
          id: '0x00158d0001a2b3c4',
          name: 'Aqara MCCGQ11LM',
          model: 'MCCGQ11LM',
          reason: 'Zigbee2MQTT is still pairing it',
          heardAt: new Date(),
        },
      ],
    });
    vi.mocked(fetchDevices).mockResolvedValue([]);
    renderPage('zigbee2mqtt', ['device:read', 'entity:control'], 'devices');

    expect(await screen.findByText('Seen but not added · 1')).toBeTruthy();
    expect(screen.getByText('Zigbee2MQTT is still pairing it')).toBeTruthy();
  });
});
