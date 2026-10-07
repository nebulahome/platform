/**
 * Installing integrations from the Community Hub: the results, an integration's own page with
 * what installing it does, the owner's word asked for code nobody reviewed, the install itself,
 * an update to the newer release, and an installed integration opened rather than offered again.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IntegrationListing } from '@nebulahome/contracts';

import {
  fetchIntegrationDetail,
  installIntegration,
  searchIntegrationCatalogue,
} from '@/library/integration-catalogue-api';

import { InstallIntegrationsDialog } from './install-integrations-dialog';

vi.mock('@/library/integration-catalogue-api', () => ({
  searchIntegrationCatalogue: vi.fn(),
  fetchIntegrationDetail: vi.fn(),
  installIntegration: vi.fn(),
  removeIntegration: vi.fn(),
  INTEGRATION_CATALOGUE_KEYS: {
    all: ['integrations', 'catalogue'],
    search: (q: string) => ['integrations', 'catalogue', 'search', q],
    detail: (id: string) => ['integrations', 'catalogue', 'detail', id],
  },
}));

vi.mock('@/library/api', () => ({
  LIBRARY_QUERY_KEYS: {
    vendors: ['library', 'vendors'],
    devices: ['library', 'devices'],
    entities: ['library', 'entities'],
  },
}));

/**
 * An integration as a search lists it, with what a test does not care about filled in.
 *
 * @param fields - What differs.
 * @returns The listing.
 */
function aListing(fields: Partial<IntegrationListing>): IntegrationListing {
  return {
    id: 'hue',
    name: 'Philips Hue',
    description: 'Lights, switches and motion sensors through the Hue bridge, all local.',
    repository: 'nebulahome/integration-hue',
    color: '#3b9dff',
    logo: null,
    isOfficial: true,
    downloads: 41_800,
    stars: 120,
    internetRequired: false,
    origin: 'hub',
    latest: {
      version: '3.1.0',
      sdk: '^1.0.0',
      requires: { packages: {}, services: [] },
      bundleKind: 'declarative',
      publishedAt: new Date('2026-09-24T08:00:00.000Z'),
      changelogUrl: null,
      source: 'index',
    },
    newestVersion: '3.1.0',
    installedVersion: null,
    isBuiltIn: false,
    hasUpdate: false,
    hasNewBuild: false,
    unavailableReason: null,
    ...fields,
  };
}

const onInstalled = vi.fn();
const onOpen = vi.fn();

/** Draws the dialog, open. */
function renderDialog(): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <InstallIntegrationsDialog
        isOpen
        onClose={vi.fn()}
        onInstalled={onInstalled}
        onOpen={onOpen}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(searchIntegrationCatalogue).mockReset();
  vi.mocked(installIntegration).mockReset();
  onInstalled.mockReset();
  onOpen.mockReset();
  vi.mocked(fetchIntegrationDetail).mockResolvedValue({
    kind: 'integration',
    id: 'hue',
    owner: 'nebulahome',
    homepageUrl: null,
    models: ['Hue Bridge v2', 'Lightstrips'],
    internetRequired: false,
    version: '3.1.0',
    publishedAt: new Date('2026-09-24T08:00:00.000Z'),
    transports: ['http'],
    bundleKind: 'declarative',
  });
  vi.mocked(searchIntegrationCatalogue).mockResolvedValue({
    items: [
      aListing({}),
      aListing({
        id: 'tuya',
        name: 'Tuya Lights',
        description: 'Bulbs and strips sold under many brands, through the Tuya cloud.',
        repository: 'tuya-local/integration-tuya',
        isOfficial: false,
        internetRequired: true,
        latest: {
          version: '0.9.0',
          sdk: '^1.0.0',
          requires: { packages: {}, services: [] },
          bundleKind: 'code',
          publishedAt: new Date('2026-09-01T08:00:00.000Z'),
          changelogUrl: null,
          source: 'index',
        },
      }),
      aListing({ id: 'govee', name: 'Govee', installedVersion: '1.0.0' }),
      aListing({ id: 'nanoleaf', name: 'Nanoleaf', installedVersion: '1.0.0', hasUpdate: true }),
    ],
    nextCursor: null,
    hubError: null,
  });
});

describe('InstallIntegrationsDialog', () => {
  it('lists the Hub’s integrations with who publishes them and what they need', async () => {
    renderDialog();

    expect(await screen.findByText('Philips Hue')).toBeTruthy();
    expect(screen.getByText('by tuya-local')).toBeTruthy();
    expect(screen.getByText('Needs the internet')).toBeTruthy();
    expect(screen.getAllByText('Installed')).toHaveLength(1);
    expect(screen.getByText('4 results')).toBeTruthy();
  });

  it('opens an integration’s page, says what installing it does, and installs it', async () => {
    vi.mocked(installIntegration).mockResolvedValue({
      vendorId: 'hue',
      action: 'installed',
      install: {
        build: '3.1.0-0a1b2c3d',
        version: '3.1.0',
        source: 'index',
        artifactSha256: 'a'.repeat(64),
        installedAt: '2026-10-07T08:00:00.000Z',
        installedBy: null,
      },
      warnings: [],
    });
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: /^Philips Hue/u }));

    expect(await screen.findByText('Talks to its devices over HTTP')).toBeTruthy();
    expect(screen.getByText('Hue Bridge v2')).toBeTruthy();
    expect(screen.getByText('by nebulahome')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Install Philips Hue' }));

    await vi.waitFor(() => {
      expect(onInstalled).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'hue' }));
    });
    expect(installIntegration).toHaveBeenCalledWith('hue', undefined);
  });

  it('asks the owner to trust code nobody reviewed before it installs it', async () => {
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: /^Tuya Lights/u }));

    const install = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Install Tuya Lights',
    });

    expect(screen.getByText('Contains code')).toBeTruthy();
    expect(install.disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: /I trust who publishes it/u }));

    expect(install.disabled).toBe(false);
  });

  it('updates an installed integration to its newer release', async () => {
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: /^Nanoleaf/u }));
    fireEvent.click(await screen.findByRole('button', { name: 'Update to 3.1.0' }));

    await vi.waitFor(() => {
      expect(installIntegration).toHaveBeenCalledWith('nanoleaf', '3.1.0');
    });
  });

  it('opens an integration already installed and current rather than offering it again', async () => {
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: /^Govee/u }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));

    expect(onOpen).toHaveBeenCalledWith('govee');
    expect(installIntegration).not.toHaveBeenCalled();
  });
});
