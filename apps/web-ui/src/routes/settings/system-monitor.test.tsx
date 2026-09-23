/**
 * The system monitor page: what it says about the machine, in words.
 *
 * The API is stood in for, and so are the charts: they are Recharts drawing SVG, which jsdom
 * cannot lay out and which says nothing a test could read. What is asserted is the text beside
 * them - the figures, the slices of the disk, the parts of the platform - which is also what
 * assistive technology reads, since the charts are hidden from it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SystemMonitorSnapshot } from '@nebula-home/contracts';

import { ApiError } from '@/lib/api-error';
import { fetchSystemMonitor } from '@/system/api';

import { SystemMonitor } from './system-monitor';

vi.mock('@/system/api', () => ({
  fetchSystemMonitor: vi.fn(),
  SYSTEM_QUERY_KEYS: { monitor: ['system', 'monitor'] },
}));

vi.mock('@/components/live-area-chart', () => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention -- the component's own name
  LiveAreaChart: () => null,
}));

vi.mock('@/components/usage-ring', () => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention -- the component's own name
  UsageRing: () => null,
}));

/** A machine a quarter busy, with a database of 1.9 GB and map tiles of 100 MB. */
const SNAPSHOT: SystemMonitorSnapshot = {
  host: {
    hostname: 'nebula-box',
    platform: 'linux',
    osName: 'Linux 6.8.0',
    arch: 'x64',
    uptimeSeconds: 3 * 86_400 + 4 * 3600,
    cpuModel: 'Intel(R) N100',
    cpuCount: 4,
  },
  sampleIntervalMs: 10_000,
  samples: [
    {
      at: new Date('2026-09-23T12:00:00.000Z'),
      cpuPercent: 25,
      memoryUsedBytes: 4_000_000_000,
      memoryTotalBytes: 16_000_000_000,
      receiveRate: 1_200_000,
      transmitRate: 300_000,
    },
  ],
  network: { interface: 'eth0', receivedBytes: 12_300_000_000, transmittedBytes: 1_100_000_000 },
  disk: {
    totalBytes: 500_000_000_000,
    freeBytes: 300_000_000_000,
    usedBytes: 200_000_000_000,
    otherBytes: 198_000_000_000,
    categories: [
      {
        id: 'core',
        kind: 'core',
        bytes: 2_000_000_000,
        parts: [
          { id: 'database', bytes: 1_900_000_000 },
          { id: 'cache/maps', bytes: 100_000_000 },
        ],
      },
    ],
    measuredAt: new Date(),
  },
};

/** Renders the page around a fresh cache. */
function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SystemMonitor />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the system monitor page', () => {
  beforeEach(() => {
    vi.mocked(fetchSystemMonitor).mockReset();
  });

  it('names the machine and says what it has', async () => {
    vi.mocked(fetchSystemMonitor).mockResolvedValue(SNAPSHOT);
    renderPage();

    expect(await screen.findByText('nebula-box')).toBeTruthy();
    expect(screen.getByText(/Linux 6\.8\.0 · x64 · up 3 d 4 h/)).toBeTruthy();
    expect(screen.getByText('4 cores')).toBeTruthy();
    expect(screen.getByText('4.0 GB in use')).toBeTruthy();
  });

  it('reads the network in both directions, with what it has carried', async () => {
    vi.mocked(fetchSystemMonitor).mockResolvedValue(SNAPSHOT);
    renderPage();

    expect(await screen.findByText('1.2 MB/s')).toBeTruthy();
    expect(screen.getByText('300 kB/s')).toBeTruthy();
    expect(screen.getByText('12.3 GB received')).toBeTruthy();
  });

  it('cuts the disk into the platform, everything else and the free space, with the parts', async () => {
    vi.mocked(fetchSystemMonitor).mockResolvedValue(SNAPSHOT);
    renderPage();

    expect(await screen.findByText('NebulaHome')).toBeTruthy();
    expect(screen.getByText('Everything else')).toBeTruthy();
    expect(screen.getByText('Database')).toBeTruthy();
    expect(screen.getByText('1.9 GB')).toBeTruthy();
    expect(screen.getByText('Map tiles')).toBeTruthy();
  });

  it('says the network cannot be read rather than showing zero traffic', async () => {
    vi.mocked(fetchSystemMonitor).mockResolvedValue({ ...SNAPSHOT, network: null });
    renderPage();

    expect(await screen.findByText(/The network cannot be read on this machine/)).toBeTruthy();
  });

  it('lists the entities an automation can use, by id', async () => {
    vi.mocked(fetchSystemMonitor).mockResolvedValue(SNAPSHOT);
    renderPage();

    expect(await screen.findByText('sensor.system_cpu_usage')).toBeTruthy();
    expect(screen.getByText('sensor.system_network_download')).toBeTruthy();
  });

  it('says why when core cannot be reached', async () => {
    vi.mocked(fetchSystemMonitor).mockRejectedValue(
      new ApiError({
        code: 'DEVICE_UNAVAILABLE',
        status: 503,
        message: 'The message bus is not reachable',
      }),
    );
    renderPage();

    expect((await screen.findByRole('alert')).textContent).toBe('The message bus is not reachable');
  });
});
