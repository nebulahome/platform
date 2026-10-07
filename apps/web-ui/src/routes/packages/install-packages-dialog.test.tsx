/**
 * Installing packages from the Community Hub: the search, the local folder's files listed first,
 * a package's own page with what installing it would take - with what it needs, or why it cannot
 * be - the install, and the way back to the results.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchPackageCatalogueDetail,
  installPackage,
  planPackage,
  searchCatalogue,
} from '@/packages/api';
import { aListing, aPackage } from '@/testing/package-fixtures';

import { InstallPackagesDialog } from './install-packages-dialog';

vi.mock('@/packages/api', () => ({
  searchCatalogue: vi.fn(),
  planPackage: vi.fn(),
  installPackage: vi.fn(),
  fetchPackageCatalogueDetail: vi.fn(),
  catalogueLogoUrl: vi.fn((sha: string | null) =>
    sha === null ? undefined : `/api/v1/catalogue/logos/${sha}`,
  ),
  PACKAGE_QUERY_KEYS: {
    all: ['packages'],
    catalogue: (q: string) => ['packages', 'catalogue', q],
    catalogueDetail: (id: string) => ['packages', 'catalogue-detail', id],
    plan: (id: string) => ['packages', 'plan', id],
  },
}));

/** A release of the local folder's. */
const LOCAL_RELEASE = {
  version: '0.1.0',
  requires: { packages: {}, services: [] },
  provides: [],
  publishedAt: new Date('2026-10-03T08:00:00.000Z'),
  changelogUrl: null,
  source: 'local' as const,
};

const onInstalled = vi.fn();
const onOpen = vi.fn();

/** Draws the dialog, open. */
function renderDialog(): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <InstallPackagesDialog isOpen onClose={vi.fn()} onInstalled={onInstalled} onOpen={onOpen} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(searchCatalogue).mockReset();
  vi.mocked(planPackage).mockReset();
  vi.mocked(installPackage).mockReset();
  vi.mocked(fetchPackageCatalogueDetail).mockResolvedValue({
    kind: 'package',
    id: 'nvr',
    owner: 'nebulahome',
    homepageUrl: null,
    models: [],
    internetRequired: null,
    version: '1.4.0',
    publishedAt: new Date('2026-10-01T08:00:00.000Z'),
    transports: [],
    bundleKind: null,
  });
  onInstalled.mockReset();
  onOpen.mockReset();
  vi.mocked(searchCatalogue).mockResolvedValue({
    items: [
      aListing({
        id: 'music-player',
        name: 'Music Player',
        description: 'A player to try packages with.',
        origin: 'local',
        isOfficial: false,
        downloads: 0,
        stars: 0,
        latest: LOCAL_RELEASE,
      }),
      aListing({ logo: 'a'.repeat(64) }),
      aListing({
        id: 'newcomer',
        name: 'Newcomer',
        latest: null,
        unavailableReason: 'No release of it is in the package index yet',
      }),
      aListing({ id: 'mqtt', name: 'MQTT', installedVersion: '1.0.0', hasNewBuild: true }),
    ],
    nextCursor: null,
    hubError: null,
  });
});

describe('InstallPackagesDialog', () => {
  it('lists the local folder’s packages first, then the Hub’s with their stars and installs', async () => {
    renderDialog();

    expect(await screen.findByText('Music Player')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'In the packages folder' }).textContent).toContain(
      'Local file',
    );
    expect(screen.getAllByText('1.8K').length).toBeGreaterThan(0);
    expect(screen.getAllByText('97').length).toBeGreaterThan(0);
    expect(searchCatalogue).toHaveBeenCalledWith('', undefined, expect.anything());
  });

  it('searches as the owner types', async () => {
    renderDialog();
    await screen.findByText('Music Player');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the Community Hub' }), {
      target: { value: '  music ' },
    });

    await vi.waitFor(() => {
      expect(searchCatalogue).toHaveBeenCalledWith('music', undefined, expect.anything());
    });
  });

  it('says why the Hub could not be asked, and lists the local folder still', async () => {
    vi.mocked(searchCatalogue).mockResolvedValue({
      items: [aListing({ id: 'music-player', name: 'Music Player', origin: 'local' })],
      nextCursor: null,
      hubError: 'No Community Hub is set: COMMUNITY_HUB_URL',
    });
    renderDialog();

    expect(
      await screen.findByText(
        "No Community Hub is set: COMMUNITY_HUB_URL. The local folder's files are listed still.",
      ),
    ).toBeTruthy();
    expect(screen.getByText('Music Player')).toBeTruthy();
  });

  it('installs a package picked, saying what else goes in with it', async () => {
    vi.mocked(planPackage).mockResolvedValue({
      install: [
        { id: 'object-detection', version: '2.0.0', name: 'Object detection' },
        { id: 'nvr', version: '1.4.0', name: 'NVR' },
      ],
      problems: [],
    });
    vi.mocked(installPackage).mockResolvedValue([aPackage({ id: 'nvr', name: 'NVR' })]);
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: /^NVR/u }));

    expect(await screen.findByText('Also installs Object detection')).toBeTruthy();
    expect(await screen.findByText('by nebulahome')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Install 2 packages' }));

    await vi.waitFor(() => {
      expect(onInstalled).toHaveBeenCalled();
    });
    expect(installPackage).toHaveBeenCalledWith('nvr');
  });

  it('says why a package cannot be installed, and does not offer to', async () => {
    vi.mocked(planPackage).mockResolvedValue({
      install: [],
      problems: ['NVR needs a package that provides object-detection, and none does'],
    });
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: /^NVR/u }));

    expect(
      await screen.findByText('NVR needs a package that provides object-detection, and none does'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install NVR' })).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: 'Packages' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Newcomer/u }));

    expect(await screen.findByText('No release of it is in the package index yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install Newcomer' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('opens a package already installed rather than offering it again', async () => {
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: /^MQTT/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(onOpen).toHaveBeenCalledWith('mqtt');
    expect(planPackage).not.toHaveBeenCalled();
  });
});
