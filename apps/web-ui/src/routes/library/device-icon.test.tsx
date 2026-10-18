import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { IntegrationVendorView } from '@nebulahome/contracts';

import { DeviceIcon } from './device-icon';

const SHELLY_LOGO = 'data:image/svg+xml;base64,c2hlbGx5';

vi.mock('@/library/api', () => ({
  fetchIcons: vi.fn(),
  fetchVendors: vi.fn(async () =>
    Promise.resolve([
      { id: 'shelly', name: 'Shelly', logo: SHELLY_LOGO, color: '#4499DD', logoPadding: 0 },
      { id: 'matter', name: 'Matter', color: '#141414', logoPadding: 0 },
    ] as unknown as IntegrationVendorView[]),
  ),
  LIBRARY_QUERY_KEYS: { icons: ['library', 'icons'], vendors: ['library', 'vendors'] },
}));

/**
 * Draws a device's icon with no icon of its own.
 *
 * @param transport - What reaches it.
 * @param vendorId - Whose it is.
 * @returns What was drawn.
 */
function drawn(transport: string, vendorId: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DeviceIcon icon={undefined} device={{ icon: null, transport, vendorId }} />
    </QueryClientProvider>,
  );
}

describe('DeviceIcon', () => {
  it("shows a Matter device's integration logo while it has no icon of its own", async () => {
    const { container } = drawn('matter', 'shelly');

    expect(await screen.findByRole('presentation', { hidden: true })).toBeTruthy();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(SHELLY_LOGO);
  });

  it("shows the broker's mark for one the platform holds, and nothing for any other device", async () => {
    const generic = drawn('matter', 'matter');

    await vi.waitFor(() => {
      expect(generic.container.querySelector('svg')).not.toBeNull();
    });
    expect(generic.container.querySelector('img')).toBeNull();

    const native = drawn('shelly/rpc', 'shelly');

    expect(native.container.querySelector('img')).toBeNull();
    expect(native.container.querySelector('.bg-surface-raised')).not.toBeNull();
  });
});
