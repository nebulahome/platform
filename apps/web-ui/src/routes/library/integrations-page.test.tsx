/**
 * The integrations grid: one card per vendor, narrowed from the header.
 *
 * The API module is stood in for. What is asserted is what the page shows for what the hub
 * lists, and what the search and the filter leave standing.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiscoveredDevice, IntegrationVendorView } from '@nebula-home/contracts';

import { useSession } from '@/auth/session-store';
import {
  fetchAreas,
  fetchDevices,
  fetchDiscovered,
  fetchIcons,
  fetchTags,
  fetchVendors,
} from '@/library/api';

import { IntegrationsPage } from './integrations-page';

vi.mock('@/library/api', () => ({
  fetchVendors: vi.fn(),
  fetchDiscovered: vi.fn(),
  fetchDevices: vi.fn(),
  adoptDiscovered: vi.fn(),
  fetchIcons: vi.fn(),
  fetchTags: vi.fn(),
  createTag: vi.fn(),
  fetchAreas: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    vendors: ['library', 'vendors'],
    discovered: ['library', 'discovered'],
    devices: ['library', 'devices'],
    icons: ['library', 'icons'],
    tags: ['library', 'tags'],
    areas: ['library', 'areas'],
  },
}));

beforeEach(() => {
  vi.mocked(fetchDiscovered).mockClear();
  vi.mocked(fetchDiscovered).mockResolvedValue([]);
  vi.mocked(fetchDevices).mockResolvedValue([]);
  vi.mocked(fetchTags).mockResolvedValue([]);
  vi.mocked(fetchAreas).mockResolvedValue([]);
  vi.mocked(fetchIcons).mockResolvedValue([]);
});

/** A Shelly relay the hub found and nobody has added. */
const FOUND: DiscoveredDevice = {
  id: '0123456789abcdef',
  vendorId: 'shelly',
  driverId: 'switch-pm',
  kind: 'shelly/switch-pm',
  source: 'mdns',
  address: '192.168.1.40',
  externalId: 'shelly1pmg3-a8032ab12345',
  name: 'Kitchen',
  model: '1PM Gen3',
  modelChoices: ['1PM Gen3'],
  modelCode: 'S3SW-001P16EU',
  swVersion: '1.4.2',
  transportConfig: { host: '192.168.1.40' },
  movedFrom: null,
  adoption: 'owner',
  firstSeenAt: new Date('2026-09-23T10:00:00.000Z'),
  lastSeenAt: new Date('2026-09-23T10:05:00.000Z'),
};

/**
 * A vendor as the list serves it.
 *
 * @param overrides - What differs from Shelly.
 * @returns The vendor.
 */
function vendor(overrides: Partial<IntegrationVendorView>): IntegrationVendorView {
  return {
    id: 'shelly',
    version: '1.0.0',
    name: 'Shelly',
    color: '#3B9DFF',
    logoPadding: 0,
    internetRequired: false,
    transports: ['http'],
    wires: ['http'],
    discoverySources: [],
    adoption: 'owner',
    pairing: null,
    listener: null,
    passedOver: [],
    account: null,
    accounts: [],
    needsAccount: false,
    containers: [],
    containerStatuses: [],
    setup: { transport: { constants: {}, fields: [] }, options: { constants: {}, fields: [] } },
    drivers: [],
    needsSetup: false,
    isConfigured: false,
    transportConfig: {},
    options: {},
    configuredAt: null,
    deviceCount: 2,
    entityCount: 6,
    ...overrides,
  };
}

/**
 * Renders the page with an owner signed in.
 *
 * @param permissions - What the owner may do; configuring integrations when not said.
 */
function renderPage(permissions: readonly string[] = ['integration:configure']): void {
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
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/integrations']}>
        <IntegrationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the integrations grid', () => {
  it('shows one card per vendor, each linking to its page, with what came in through it', async () => {
    vi.mocked(fetchVendors).mockResolvedValue([
      vendor({}),
      vendor({
        id: 'bambu-lab',
        name: 'Bambu Lab',
        transports: ['mqtt'],
        wires: ['mqtt'],
        discoverySources: [],
        adoption: 'owner',
        pairing: null,
        listener: null,
        passedOver: [],
        account: null,
        accounts: [],
        needsAccount: false,
        containers: [],
        containerStatuses: [],
        entityCount: 12,
      }),
    ]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Shelly' })).toBeTruthy();
    });
    expect(screen.getByRole('link', { name: 'Bambu Lab' }).getAttribute('href')).toBe(
      '/integrations/bambu-lab',
    );
    expect(screen.getByRole('link', { name: 'Shelly' }).textContent).toContain('2devices');
    expect(screen.getByRole('link', { name: 'Bambu Lab' }).textContent).toContain('12entities');
  });

  it('marks a vendor that needs the internet, and one that still needs setting up', async () => {
    vi.mocked(fetchVendors).mockResolvedValue([
      vendor({ id: 'tuya', name: 'Tuya', internetRequired: true, needsSetup: true }),
    ]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Needs the internet' })).toBeTruthy();
    });
    expect(screen.getByRole('link', { name: 'Tuya' }).textContent).toContain('Needs setup');
  });

  it('narrows the grid from the search in the header', async () => {
    vi.mocked(fetchVendors).mockResolvedValue([
      vendor({}),
      vendor({ id: 'bambu-lab', name: 'Bambu Lab', transports: ['mqtt'], wires: ['mqtt'] }),
    ]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Shelly' })).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'bambu' } });

    expect(screen.queryByRole('link', { name: 'Shelly' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Bambu Lab' })).toBeTruthy();
  });

  it('narrows the grid by the wire, from the filter in the header', async () => {
    vi.mocked(fetchVendors).mockResolvedValue([
      vendor({}),
      vendor({ id: 'bambu-lab', name: 'Bambu Lab', transports: ['mqtt'], wires: ['mqtt'] }),
    ]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Shelly' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Filter/u }));
    fireEvent.click(screen.getByRole('radio', { name: 'MQTT' }));

    expect(screen.queryByRole('link', { name: 'Shelly' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Bambu Lab' })).toBeTruthy();
  });

  it('keeps the catalogue button, for when there is a catalogue', async () => {
    vi.mocked(fetchVendors).mockResolvedValue([vendor({})]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Shelly' })).toBeTruthy();
    });

    const install = screen.getByRole<HTMLButtonElement>('button', { name: 'Install integration' });

    expect(install.disabled).toBe(true);
  });
});

describe('the devices found on the network', () => {
  it('are counted on their vendor card, and left to the vendor page to adopt', async () => {
    vi.mocked(fetchVendors).mockResolvedValue([vendor({})]);
    vi.mocked(fetchDiscovered).mockResolvedValue([FOUND]);
    renderPage(['device:read', 'device:write']);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Shelly' }).textContent).toContain('1 found');
    });
    expect(screen.queryByRole('region', { name: /Found on your network/u })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Adopt Kitchen' })).toBeNull();
  });

  it('leave looking for them to each vendor page', async () => {
    // Looking is per vendor: the page for all of them offers no search of its own.
    vi.mocked(fetchVendors).mockResolvedValue([vendor({ discoverySources: ['mdns'] })]);
    renderPage(['device:read', 'device:write']);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Shelly' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: /Scan network|Discover devices/u })).toBeNull();
  });

  it('are not asked for from somebody who may not see devices', async () => {
    vi.mocked(fetchVendors).mockResolvedValue([vendor({})]);
    vi.mocked(fetchDiscovered).mockResolvedValue([FOUND]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Shelly' })).toBeTruthy();
    });

    expect(fetchDiscovered).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Shelly' }).textContent).not.toContain('found');
  });
});
