/**
 * The integrations grid: one card per vendor, narrowed from the header.
 *
 * The API module is stood in for. What is asserted is what the page shows for what the hub
 * lists, and what the search and the filter leave standing.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type { IntegrationVendorView } from '@nebula-home/contracts';

import { useSession } from '@/auth/session-store';
import { fetchVendors } from '@/library/api';

import { IntegrationsPage } from './integrations-page';

vi.mock('@/library/api', () => ({
  fetchVendors: vi.fn(),
  LIBRARY_QUERY_KEYS: { vendors: ['library', 'vendors'] },
}));

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

/** Renders the page with an owner signed in. */
function renderPage(): void {
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
      vendor({ id: 'bambu-lab', name: 'Bambu Lab', transports: ['mqtt'] }),
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
      vendor({ id: 'bambu-lab', name: 'Bambu Lab', transports: ['mqtt'] }),
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
