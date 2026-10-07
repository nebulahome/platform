/**
 * The packages page: what is installed, where each stands and the updates out, and the button
 * that opens the Community Hub's search - for who may install.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSession } from '@/auth/session-store';
import { fetchAvailablePackages, fetchPackages, searchCatalogue } from '@/packages/api';
import { aListing, aPackage, anOffer } from '@/testing/package-fixtures';

import { PackagesPage } from './packages-page';

vi.mock('@/packages/api', () => ({
  fetchPackages: vi.fn(),
  fetchAvailablePackages: vi.fn(),
  searchCatalogue: vi.fn(),
  planPackage: vi.fn(),
  installPackage: vi.fn(),
  packageLogoUrl: vi.fn(() => undefined),
  catalogueLogoUrl: vi.fn(() => undefined),
  PACKAGE_QUERY_KEYS: {
    all: ['packages'],
    list: ['packages', 'list'],
    available: ['packages', 'available'],
    catalogue: (q: string) => ['packages', 'catalogue', q],
    catalogueDetail: (id: string) => ['packages', 'catalogue-detail', id],
    plan: (id: string) => ['packages', 'plan', id],
  },
}));

/**
 * Draws the page, for somebody who may do what is given.
 *
 * @param permissions - What they may do.
 */
function renderPage(permissions: readonly string[] = ['package:read', 'package:install']): void {
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
      <MemoryRouter initialEntries={['/packages']}>
        <Routes>
          <Route path="/packages" element={<PackagesPage />} />
          <Route path="/packages/:packageId" element={<p>The package page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(fetchPackages).mockReset();
  vi.mocked(fetchAvailablePackages).mockReset();
  vi.mocked(searchCatalogue).mockReset();
  vi.mocked(fetchPackages).mockResolvedValue([aPackage()]);
  vi.mocked(searchCatalogue).mockResolvedValue({
    items: [aListing()],
    nextCursor: null,
    hubError: null,
  });
  vi.mocked(fetchAvailablePackages).mockResolvedValue({
    items: [
      anOffer({
        id: 'mqtt',
        name: 'MQTT',
        description: 'The broker.',
        installedVersion: '1.0.0',
        hasUpdate: true,
        newestVersion: '1.1.0',
        latest: {
          version: '1.1.0',
          requires: { packages: {}, services: [] },
          provides: ['mqtt-broker'],
          publishedAt: new Date('2026-09-25T08:00:00.000Z'),
          changelogUrl: null,
          source: 'index',
        },
      }),
      anOffer(),
    ],
    checkedAt: new Date('2026-09-29T08:00:00.000Z'),
    error: null,
  });
});

describe('PackagesPage', () => {
  it('lists what is installed, where each stands, and the updates out', async () => {
    renderPage();

    const tile = await screen.findByRole('link', { name: 'MQTT' });

    expect(within(tile).getByText('Running')).toBeTruthy();
    expect(within(tile).getByText('System')).toBeTruthy();
    expect(await within(tile).findByText('Update')).toBeTruthy();
    expect(screen.getByText(/1 update out/u)).toBeTruthy();
    // What the index offers is no list of its own here: only the updates are read from it.
    expect(screen.queryByText('Records the cameras.')).toBeNull();
  });

  it('opens the Community Hub’s search from Install packages', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Install packages' }));

    expect(await screen.findByRole('heading', { name: 'Install a package' })).toBeTruthy();
    expect(await screen.findByText('Records the cameras.')).toBeTruthy();
  });

  it('offers no Install packages to somebody who may only look', async () => {
    renderPage(['package:read']);

    expect(await screen.findByRole('link', { name: 'MQTT' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Install packages' })).toBeNull();
  });
});
