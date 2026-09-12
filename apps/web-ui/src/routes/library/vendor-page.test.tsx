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

import type { IntegrationVendorView, IntegrationView } from '@nebula-home/contracts';

import { useSession } from '@/auth/session-store';
import { fetchIntegrations, fetchVendor } from '@/library/api';

import { VendorPage } from './vendor-page';

vi.mock('@/library/api', () => ({
  fetchVendor: vi.fn(),
  fetchIntegrations: vi.fn(),
  createIntegration: vi.fn(),
  updateIntegration: vi.fn(),
  probeIntegration: vi.fn(),
  updateVendorConfig: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    vendors: ['library', 'vendors'],
    integrations: ['library', 'integrations'],
  },
}));

/** Bambu Lab, as the vendor route serves it. */
const BAMBU: IntegrationVendorView = {
  id: 'bambu-lab',
  version: '1.0.0',
  name: 'Bambu Lab',
  description: 'Printers in LAN mode, over the broker each one runs itself.',
  url: 'https://bambulab.com',
  color: '#00AE42',
  internetRequired: false,
  transports: ['mqtt'],
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
  instanceCount: 2,
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
  instanceCount: 0,
  entityCount: 0,
};

/**
 * An instance of the printer driver.
 *
 * @param overrides - What differs from a running X1C.
 * @returns The instance.
 */
function instance(overrides: Partial<IntegrationView>): IntegrationView {
  return {
    id: 'bambu-lab-x1c',
    kind: 'bambu-lab/printer',
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
    deviceCount: 0,
    entityCount: 6,
    ...overrides,
  };
}

beforeAll(() => {
  // jsdom implements `<dialog>` but not the modal behaviour behind it.
  if (typeof globalThis.HTMLDialogElement.prototype.showModal !== 'function') {
    globalThis.HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }

  if (typeof globalThis.HTMLDialogElement.prototype.close !== 'function') {
    globalThis.HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.open = false;
    };
  }
});

/**
 * Renders the page for one vendor with an owner signed in.
 *
 * @param vendorId - Which vendor the address names.
 */
function renderPage(vendorId: string): void {
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: [{ key: 'integration:configure', scope: '*', effect: 'allow' }],
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
  it('says who the vendor is, and lists each device added with the model picked and its state', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(BAMBU);
    vi.mocked(fetchIntegrations).mockResolvedValue([
      instance({}),
      instance({
        id: 'bambu-lab-p1s',
        model: 'P1S',
        state: 'failed',
        lastError: 'mqtts://192.168.1.61:8883 did not answer: ECONNREFUSED',
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
      expect.stringContaining('X1C'),
      expect.stringContaining('P1S'),
    ]);
    expect(rows[1]?.textContent).toContain('failed');
    expect(rows[1]?.textContent).toContain('ECONNREFUSED');
  });

  it('opens the add-device dialog with the vendor, offering its models', async () => {
    vi.mocked(fetchVendor).mockResolvedValue(BAMBU);
    vi.mocked(fetchIntegrations).mockResolvedValue([]);
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
    vi.mocked(fetchIntegrations).mockResolvedValue([]);
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
    vi.mocked(fetchIntegrations).mockResolvedValue([]);
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
    vi.mocked(fetchIntegrations).mockResolvedValue([]);
    renderPage('bambu-lab');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    });

    expect(screen.queryByRole('button', { name: 'Configure' })).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove' }).disabled).toBe(true);
  });
});
