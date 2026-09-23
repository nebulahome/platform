/**
 * The tags page: every tag, what each is on, and the ways to narrow the list.
 *
 * The API is stood in for. The join between a tag and what carries it is done on the page from
 * the devices and entities it already reads, so that is what is asserted: a tag row opens to
 * the device and the entity that carry it, by name.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  entityIdSchema,
  type DeviceView,
  type EntityView,
  type TagView,
} from '@nebula-home/contracts';

import { useSession } from '@/auth/session-store';
import { fetchDevices, fetchEntities, fetchIcons, fetchTags } from '@/library/api';

import { TagsPage } from './tags-page';

vi.mock('@/library/api', () => ({
  fetchTags: vi.fn(),
  fetchDevices: vi.fn(),
  fetchEntities: vi.fn(),
  fetchIcons: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    tags: ['library', 'tags'],
    devices: ['library', 'devices'],
    entities: ['library', 'entities'],
    icons: ['library', 'icons'],
  },
}));

const EXTERIOR: TagView = {
  id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
  key: 'exterior',
  name: 'Exterior',
  color: 'green',
  icon: 'sun',
  deviceCount: 1,
  entityCount: 1,
};

const SPARE: TagView = {
  id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e70',
  key: 'spare',
  name: 'Spare',
  color: 'pink',
  icon: null,
  deviceCount: 0,
  entityCount: 0,
};

const RELAY: DeviceView = {
  id: 'shelly-bench',
  name: 'Bench relay',
  icon: 'relay',
  kind: 'shelly/1pm-mini-g3',
  kindVersion: '1.0.0',
  vendorId: 'shelly',
  driverId: '1pm-mini-g3',
  driverName: '1PM Mini Gen3',
  model: '1PM Mini Gen3',
  transport: 'http',
  transportConfig: {},
  options: {},
  isEnabled: true,
  state: 'running',
  lastError: null,
  lastStartedAt: null,
  lastUpdatedAt: null,
  externalId: null,
  manufacturer: 'Shelly',
  swVersion: null,
  hwVersion: null,
  areaId: null,
  areaKey: null,
  areaName: null,
  entityIds: [entityIdSchema.parse('switch.shelly_bench_switch')],
  tagIds: [EXTERIOR.id],
};

const SWITCH: EntityView = {
  entityId: entityIdSchema.parse('switch.shelly_bench_switch'),
  domain: 'switch',
  name: 'Switch',
  icon: 'switch',
  areaKey: null,
  areaName: null,
  deviceId: '00000000-0000-4000-8000-000000000010',
  source: 'shelly-bench',
  unitOfMeasurement: null,
  deviceClass: null,
  isEnabled: true,
  isHidden: false,
  capabilities: [{ capability: 'on_off', params: {} }],
  searchAliases: [],
  state: null,
  attributes: {},
  isAvailable: true,
  lastChanged: null,
  lastUpdated: null,
  tagIds: [EXTERIOR.id],
};

/**
 * Renders the page with somebody who may edit tags signed in.
 *
 * @param permissions - What they hold.
 */
function renderPage(permissions: string[] = ['tag:read', 'tag:write']): void {
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: permissions.map((key) => ({ key, scope: '*', effect: 'allow' })),
      avatarUrl: null,
      locale: 'it',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/tags']}>
        <TagsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(fetchTags).mockResolvedValue([EXTERIOR, SPARE]);
  vi.mocked(fetchDevices).mockResolvedValue([RELAY]);
  vi.mocked(fetchEntities).mockResolvedValue([SWITCH]);
  vi.mocked(fetchIcons).mockResolvedValue([]);
});

describe('TagsPage', () => {
  it('lists every tag by name, with how many devices and entities carry it', async () => {
    renderPage();

    const row = await screen.findByRole('button', { name: /^Exterior/u });

    expect(row.textContent).toContain('1 device');
    expect(row.textContent).toContain('1 entity');
    expect(screen.getByRole('button', { name: /^Spare/u }).textContent).toContain('On nothing yet');
  });

  it('draws a tag by its own icon, read from the catalogue', async () => {
    vi.mocked(fetchIcons).mockImplementation((request) =>
      Promise.resolve(
        (request.ids ?? []).includes('sun')
          ? [
              {
                id: 'sun',
                name: 'Sun',
                keywords: [],
                origin: 'builtin',
                isOverridden: false,
                node: [['rect', { x: '2', y: '2', width: '20', height: '20' }]],
                frame: { x: 0, y: 0, size: 24 },
              },
            ]
          : [],
      ),
    );
    renderPage();

    const row = await screen.findByRole('button', { name: /^Exterior/u });

    await waitFor(() => {
      expect(row.querySelector('svg rect')).toBeTruthy();
    });
    // The chip is open here: an owner scanning the page should not have to hover each glyph to
    // learn what it is.
    expect(screen.getByTitle('Exterior').className).not.toContain('group-hover');
    expect(row.textContent).toContain('Exterior');
  });

  it('opens a tag to the devices and the entities that carry it', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /^Exterior/u }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Bench relay/u }).getAttribute('href')).toBe(
        '/devices?device=shelly-bench',
      );
    });
    expect(screen.getByText('Switch')).toBeTruthy();
    expect(screen.getByText('switch.shelly_bench_switch')).toBeTruthy();
  });

  it('narrows the list by what is typed, and by what carries a tag', async () => {
    renderPage();
    await screen.findByRole('button', { name: /^Exterior/u });

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'spa' } });

    expect(screen.queryByRole('button', { name: /^Exterior/u })).toBeNull();
    expect(screen.getByRole('button', { name: /^Spare/u })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Filter/u }));
    fireEvent.click(screen.getByRole('radio', { name: 'Nothing' }));

    expect(screen.queryByRole('button', { name: /^Exterior/u })).toBeNull();
    expect(screen.getByRole('button', { name: /^Spare/u })).toBeTruthy();
  });

  it('offers a new tag to somebody who may make one, and not to somebody who may not', async () => {
    renderPage();

    expect(await screen.findByRole('button', { name: 'New tag' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New tag' }));

    expect(screen.getByRole('dialog').textContent).toContain('New tag');
  });

  it('opens the dialog for the first tag too, when there are none yet', async () => {
    vi.mocked(fetchTags).mockResolvedValue([]);

    renderPage();

    // The page frame shows a notice instead of its children while the list is empty, and the
    // dialog used to be one of those children - so the first tag could never be made.
    expect(await screen.findByText(/No tags yet/u)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New tag' }));

    expect(screen.getByRole('dialog').textContent).toContain('New tag');
  });

  it('keeps the spanner and the new-tag button from somebody who may only read', async () => {
    renderPage(['tag:read']);

    await screen.findByRole('button', { name: /^Exterior/u });

    expect(screen.queryByRole('button', { name: 'New tag' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Configure Exterior/u })).toBeNull();
  });
});
