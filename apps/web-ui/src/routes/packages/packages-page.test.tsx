/**
 * The packages page: what is installed, what the index offers, and installing one - with what
 * it needs, or why it cannot be.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSession } from '@/auth/session-store';
import { fetchAvailablePackages, fetchPackages, installPackage, planPackage } from '@/packages/api';
import { aPackage, anOffer } from '@/testing/package-fixtures';

import { PackagesPage } from './packages-page';

vi.mock('@/packages/api', () => ({
  fetchPackages: vi.fn(),
  fetchAvailablePackages: vi.fn(),
  planPackage: vi.fn(),
  installPackage: vi.fn(),
  packageLogoUrl: vi.fn(() => undefined),
  PACKAGE_QUERY_KEYS: {
    all: ['packages'],
    list: ['packages', 'list'],
    available: ['packages', 'available'],
  },
}));

/**
 * Draws the page at an address, for somebody who may do what is given.
 *
 * @param address - Where.
 * @param permissions - What they may do.
 */
function renderPage(
  address = '/packages',
  permissions: readonly string[] = ['package:read', 'package:install'],
): void {
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
      <MemoryRouter initialEntries={[address]}>
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
  vi.mocked(planPackage).mockReset();
  vi.mocked(installPackage).mockReset();
  vi.mocked(fetchPackages).mockResolvedValue([aPackage()]);
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
  });

  it('installs what the index offers, saying what else goes in with it', async () => {
    vi.mocked(planPackage).mockResolvedValue({
      install: [
        { id: 'object-detection', version: '2.0.0', name: 'Object detection' },
        { id: 'nvr', version: '1.4.0', name: 'NVR' },
      ],
      problems: [],
    });
    vi.mocked(installPackage).mockResolvedValue([aPackage({ id: 'nvr', name: 'NVR' })]);
    renderPage('/packages?view=available');

    fireEvent.click(await screen.findByRole('button', { name: 'Install' }));

    expect(await screen.findByText('Also installs Object detection, which it needs.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Install 2 packages' }));

    expect(await screen.findByText('The package page')).toBeTruthy();
    expect(installPackage).toHaveBeenCalledWith('nvr');
  });

  it('says why a package cannot be installed, and does not offer to', async () => {
    vi.mocked(planPackage).mockResolvedValue({
      install: [],
      problems: ['NVR needs a package that provides object-detection, and none does'],
    });
    renderPage('/packages?view=available');

    fireEvent.click(await screen.findByRole('button', { name: 'Install' }));

    expect(
      await screen.findByText('NVR needs a package that provides object-detection, and none does'),
    ).toBeTruthy();
    expect(
      (screen.getAllByRole('button', { name: 'Install' }).at(-1) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('offers no Install to somebody who may only look', async () => {
    renderPage('/packages?view=available', ['package:read']);

    expect(await screen.findByText('Records the cameras.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
  });
});
