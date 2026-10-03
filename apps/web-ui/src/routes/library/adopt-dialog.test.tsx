/**
 * Adopting a device found on the network: what the owner decides, and only what discovery
 * could not fill.
 *
 * The API module is stood in for; the interest is in what the dialog asks of it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DeviceView,
  DiscoveredDevice,
  IconView,
  IntegrationVendorView,
} from '@nebulahome/contracts';

import { ApiError } from '@/lib/api-error';
import { adoptDiscovered, fetchAreas, fetchIcons, fetchTags } from '@/library/api';

import { AdoptDialog, type AdoptDialogTarget } from './adopt-dialog';

vi.mock('@/library/api', () => ({
  adoptDiscovered: vi.fn(),
  fetchIcons: vi.fn(),
  fetchTags: vi.fn(),
  createTag: vi.fn(),
  fetchAreas: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    icons: ['library', 'icons'],
    tags: ['library', 'tags'],
    areas: ['library', 'areas'],
  },
}));

/** Bambu Lab: one printer driver, an address and an access code. */
const BAMBU: IntegrationVendorView = {
  id: 'bambu-lab',
  version: '1.0.0',
  name: 'Bambu Lab',
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
      defaultIcon: 'printer',
      setup: {
        transport: {
          constants: { username: 'bblp' },
          fields: [
            {
              key: 'url',
              type: 'text',
              label: 'Printer address',
              isRequired: true,
              maxLength: 512,
            },
            {
              key: 'password',
              type: 'secret',
              label: 'Access code',
              isRequired: true,
              minLength: 8,
              maxLength: 8,
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
  entityCount: 0,
};

/**
 * A printer discovery heard, varied by the test.
 *
 * @param overrides - What differs.
 * @returns The device, as the list serves it.
 */
function found(overrides: Partial<DiscoveredDevice> = {}): DiscoveredDevice {
  return {
    id: '0123456789abcdef',
    vendorId: 'bambu-lab',
    driverId: 'printer',
    kind: 'bambu-lab/printer',
    source: 'mdns',
    address: '192.168.1.70',
    externalId: '01P00A000000001',
    name: 'Workshop',
    model: 'X1C',
    modelChoices: ['X1C'],
    modelCode: 'BL-P001',
    swVersion: null,
    transportConfig: { url: 'mqtts://192.168.1.70:8883' },
    movedFrom: null,
    adoption: 'owner',
    firstSeenAt: new Date('2026-09-23T10:00:00.000Z'),
    lastSeenAt: new Date('2026-09-23T10:00:00.000Z'),
    ...overrides,
  };
}

/**
 * An icon as the catalogue serves it.
 *
 * @param id - Its id.
 * @returns The icon.
 */
function iconView(id: string): IconView {
  return {
    id,
    name: id,
    keywords: [],
    origin: 'builtin',
    isOverridden: false,
    node: [['circle', { cx: '12', cy: '12', r: '4' }]],
    frame: { x: 0, y: 0, size: 24 },
  };
}

/** The device the API answers an adoption with. */
const ADOPTED: DeviceView = {
  id: 'bambu-lab-workshop',
  name: 'Workshop',
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
  transportConfig: { url: 'mqtts://192.168.1.70:8883', password: { $sealed: true } },
  options: {},
  isEnabled: true,
  state: 'identifying',
  lastError: null,
  lastStartedAt: null,
  lastUpdatedAt: null,
  externalId: '01P00A000000001',
  manufacturer: 'Bambu Lab',
  swVersion: null,
  hwVersion: null,
  areaId: null,
  areaKey: null,
  areaName: null,
  entityIds: [],
  tagIds: [],
};

beforeAll(() => {
  vi.mocked(fetchTags).mockResolvedValue([]);
  vi.mocked(fetchAreas).mockResolvedValue([]);
  vi.mocked(fetchIcons).mockImplementation((request) =>
    Promise.resolve((request.ids ?? ['printer']).map(iconView)),
  );
});

beforeEach(() => {
  vi.mocked(adoptDiscovered).mockReset();
});

/**
 * Renders the dialog inside what it needs.
 *
 * @param target - What is being adopted.
 * @returns The callbacks it was given.
 */
function renderDialog(target: AdoptDialogTarget) {
  const onAdopted = vi.fn();
  const onClose = vi.fn();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <AdoptDialog target={target} onClose={onClose} onAdopted={onAdopted} />
    </QueryClientProvider>,
  );

  return { onAdopted, onClose };
}

describe('AdoptDialog', () => {
  it('starts from what the device said, and asks only for what discovery could not fill', () => {
    renderDialog({ device: found(), vendor: BAMBU, existingIds: [] });

    expect(screen.getByRole('dialog', { name: 'Adopt Workshop' })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Workshop');
    expect(screen.getByLabelText('Access code')).toBeTruthy();
    expect(screen.queryByLabelText('Printer address')).toBeNull();
    expect(screen.queryByLabelText('Model')).toBeNull();
  });

  it('adds the device under an id made from its name, with what was typed', async () => {
    vi.mocked(adoptDiscovered).mockResolvedValue(ADOPTED);
    const { onAdopted } = renderDialog({
      device: found(),
      vendor: BAMBU,
      existingIds: ['bambu-lab-workshop'],
    });

    fireEvent.change(screen.getByLabelText('Access code'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adopt' }));

    await waitFor(() => {
      expect(onAdopted).toHaveBeenCalledWith(ADOPTED);
    });
    expect(adoptDiscovered).toHaveBeenCalledWith('0123456789abcdef', {
      id: 'bambu-lab-workshop-2',
      name: 'Workshop',
      icon: 'printer',
      tagIds: [],
      transportConfig: { password: '12345678' },
      options: {},
    });
  });

  it('stops at a field the driver needs and nobody filled, before asking the server', () => {
    renderDialog({ device: found(), vendor: BAMBU, existingIds: [] });

    fireEvent.click(screen.getByRole('button', { name: 'Adopt' }));

    expect(adoptDiscovered).not.toHaveBeenCalled();
  });

  it('asks which of the family it is when the device did not say, and sends the pick', async () => {
    vi.mocked(adoptDiscovered).mockResolvedValue(ADOPTED);
    renderDialog({
      device: found({ name: null, model: null, modelChoices: ['X1C', 'P1S'] }),
      vendor: BAMBU,
      existingIds: [],
    });

    fireEvent.click(screen.getByLabelText('Model'));
    fireEvent.click(await screen.findByRole('option', { name: 'P1S' }));
    fireEvent.change(screen.getByLabelText('Access code'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adopt' }));

    await waitFor(() => {
      expect(adoptDiscovered).toHaveBeenCalledWith(
        '0123456789abcdef',
        expect.objectContaining({ model: 'P1S', name: 'P1S', id: 'bambu-lab-p1s' }),
      );
    });
  });

  it('shows what the server refused, where the person is', async () => {
    vi.mocked(adoptDiscovered).mockRejectedValue(
      new ApiError({
        status: 404,
        code: 'NOT_FOUND',
        message: 'The hub does not propose that device, or no longer does',
      }),
    );
    renderDialog({ device: found(), vendor: BAMBU, existingIds: [] });

    fireEvent.change(screen.getByLabelText('Access code'), { target: { value: '12345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adopt' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('no longer does');
    });
  });
});
