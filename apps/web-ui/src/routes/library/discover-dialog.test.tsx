/**
 * The dialog around a discovery pass: what Scan asks for, what the pass shows, what Adopt sends.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { entityIdSchema, type IntegrationView } from '@nebula-home/contracts';

import { adoptCandidate, fetchCandidates, startDiscovery } from '@/library/api';

import { DiscoverDialog } from './discover-dialog';

vi.mock('@/library/api', () => ({
  fetchIntegrations: vi.fn(),
  fetchCandidates: vi.fn(),
  startDiscovery: vi.fn(),
  adoptCandidate: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    devices: ['library', 'devices'],
    entities: ['library', 'entities'],
    integrations: ['library', 'integrations'],
    candidates: ['library', 'candidates'],
  },
}));

/** The one instance configured. */
const PRINTER_INSTANCE: IntegrationView = {
  id: 'bambu-lab-1',
  kind: 'bambu-lab/printer',
  kindVersion: '1.0.0',
  vendorId: 'bambu-lab',
  driverId: 'printer',
  driverName: 'Printer',
  model: 'P1S',
  transport: 'mqtt',
  transportConfig: { url: 'mqtts://192.168.1.60:8883' },
  options: {},
  isEnabled: true,
  state: 'running',
  lastError: null,
  lastStartedAt: null,
  deviceCount: 0,
  entityCount: 0,
};

beforeAll(async () => {
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

  const { fetchIntegrations } = await import('@/library/api');

  vi.mocked(fetchIntegrations).mockResolvedValue([PRINTER_INSTANCE]);
});

describe('DiscoverDialog', () => {
  it('starts a pass on the chosen instance, shows what it finds, and adopts on a click', async () => {
    vi.mocked(startDiscovery).mockResolvedValue({
      scanId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      integrationIds: ['bambu-lab-1'],
    });
    vi.mocked(fetchCandidates).mockResolvedValue({
      isScanning: false,
      candidates: [
        {
          candidateId: 'scan-1:01P00A000000042',
          integrationId: 'bambu-lab-1',
          externalId: '01P00A000000042',
          name: 'Bambu Lab P1S',
          manufacturer: 'Bambu Lab',
          model: 'P1S',
          entities: [
            {
              entityId: entityIdSchema.parse('light.d_01p00a000000042_chamber_light'),
              name: 'Chamber light',
              capabilities: ['on_off'],
            },
          ],
          evidence: {},
        },
      ],
    });
    vi.mocked(adoptCandidate).mockResolvedValue({
      deviceId: '00000000-0000-4000-8000-000000000010',
      entityIds: [entityIdSchema.parse('light.d_01p00a000000042_chamber_light')],
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <DiscoverDialog isOpen onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    await screen.findByRole('combobox', { name: /Look with/u });
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));

    await waitFor(() => {
      expect(screen.getByText('Bambu Lab P1S')).toBeTruthy();
    });
    expect(startDiscovery).toHaveBeenCalledWith({ timeoutMs: 30_000 });
    expect(screen.getByText('light.d_01p00a000000042_chamber_light')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('1 found');

    fireEvent.click(screen.getByRole('button', { name: 'Adopt' }));

    await waitFor(() => {
      expect(screen.getByText('Adopted')).toBeTruthy();
    });
    expect(adoptCandidate).toHaveBeenCalledWith({ candidateId: 'scan-1:01P00A000000042' });
  });
});
