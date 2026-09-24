/**
 * The registry page: every device as a row that leads to its own page, its standing read off the
 * live channel, and the search and the filters narrowing the list.
 *
 * The API module is stood in for; the live store is the real one, fed the way the channel would
 * feed it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSession } from '@/auth/session-store';
import {
  fetchAreas,
  fetchDevices,
  fetchEntities,
  fetchIcons,
  fetchTags,
  fetchVendors,
} from '@/library/api';
import { useLive } from '@/live/live-store';
import { anArea } from '@/testing/fixtures';
import {
  EXTERIOR,
  NOZZLE_ID,
  PRINTER,
  printerEntities,
  RELAY,
  VENDORS,
} from '@/testing/printer-fixtures';

import { DevicesPage } from './devices-page';

vi.mock('@/library/api', () => ({
  fetchAreas: vi.fn(),
  fetchDevices: vi.fn(),
  fetchEntities: vi.fn(),
  fetchVendors: vi.fn(),
  fetchIcons: vi.fn(),
  fetchTags: vi.fn(),
  createTag: vi.fn(),
  updateEntity: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    areas: ['library', 'areas'],
    devices: ['library', 'devices'],
    entities: ['library', 'entities'],
    vendors: ['library', 'vendors'],
    icons: ['library', 'icons'],
    tags: ['library', 'tags'],
  },
}));

/**
 * Renders the page with an owner signed in.
 */
function renderPage(): void {
  useSession.setState({
    status: 'signed-in',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'mattia',
      displayName: 'Mattia Carli',
      role: 'owner',
      permissions: [
        { key: 'device:write', scope: '*', effect: 'allow' },
        { key: 'entity:write', scope: '*', effect: 'allow' },
        { key: 'integration:read', scope: '*', effect: 'allow' },
      ],
      avatarUrl: null,
      locale: 'it',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/devices']}>
        <DevicesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * The row a device is drawn in, found by the link that leads to its page.
 *
 * @param name - The device's name.
 * @returns The row.
 */
async function rowOf(name: string): Promise<HTMLElement> {
  const link = await screen.findByRole('link', { name });

  return link.closest('li') ?? link;
}

beforeEach(() => {
  useLive.getState().reset();
  vi.mocked(fetchAreas).mockResolvedValue([]);
  vi.mocked(fetchDevices).mockResolvedValue([PRINTER, RELAY]);
  vi.mocked(fetchVendors).mockResolvedValue(VENDORS);
  vi.mocked(fetchIcons).mockResolvedValue([]);
  vi.mocked(fetchTags).mockResolvedValue([EXTERIOR]);
  vi.mocked(fetchEntities).mockResolvedValue(printerEntities());
});

describe('DevicesPage', () => {
  it('lists the device under its vendor by name, silent until something reports', async () => {
    renderPage();

    const row = await rowOf('Workshop printer');

    expect(row.textContent).toContain('Bambu Lab');
    expect(row.textContent).toContain('Silent');
    expect(screen.queryByText('Registry')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add device' })).toBeNull();
  });

  it('leads from each row to the device’s own page, and opens nothing in place', async () => {
    renderPage();

    const row = await rowOf('Workshop printer');

    expect(within(row).getByRole('link', { name: 'Workshop printer' }).getAttribute('href')).toBe(
      '/devices/bambu-lab-p1s',
    );
    expect(row.getAttribute('aria-expanded')).toBeNull();
    expect(screen.queryByText('Nozzle temperature')).toBeNull();
  });

  it('says one word for a device that is switched off', async () => {
    renderPage();

    const row = await rowOf('Garage relay');

    expect(row.textContent).toContain('disabled');
    expect(row.textContent).not.toContain('Silent');
  });

  it('turns the device to reporting when the channel delivers a reading of it', async () => {
    renderPage();
    await rowOf('Workshop printer');

    useLive.getState().apply({
      type: 'state_changed',
      entityId: NOZZLE_ID,
      state: { sensor_numeric: { value: 215 } },
      attributes: {},
      isAvailable: true,
      changedAt: new Date(),
    });

    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: 'Workshop printer' }).closest('li')?.textContent,
      ).toContain('Reporting');
    });
  });

  it('narrows the list by what is typed, through the entities and their tags too', async () => {
    renderPage();
    await rowOf('Workshop printer');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'chamber' } });
    expect(screen.getByRole('link', { name: 'Workshop printer' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Garage relay' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'exterior' } });
    expect(await screen.findByRole('link', { name: 'Workshop printer' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'nothing here' } });
    expect(screen.queryByRole('link', { name: 'Workshop printer' })).toBeNull();
    expect(screen.getByText(/Nothing matches/u)).toBeTruthy();
  });

  it('narrows the list by vendor and by area, from the filter in the header', async () => {
    renderPage();
    await rowOf('Workshop printer');

    fireEvent.click(screen.getByRole('button', { name: /Filter/u }));
    fireEvent.click(await screen.findByRole('combobox', { name: /integration/iu }));
    fireEvent.click(screen.getByRole('option', { name: 'Shelly' }));

    expect(screen.queryByRole('link', { name: 'Workshop printer' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Garage relay' })).toBeTruthy();

    fireEvent.click(screen.getByRole('combobox', { name: /integration/iu }));
    fireEvent.click(screen.getByRole('option', { name: 'Any integration' }));
    fireEvent.click(screen.getByRole('combobox', { name: /^Area/u }));
    fireEvent.click(screen.getByRole('option', { name: 'Garage' }));

    expect(screen.queryByRole('link', { name: 'Workshop printer' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Garage relay' })).toBeTruthy();
  });

  it('offers the areas under their floors, the floors by their number', async () => {
    vi.mocked(fetchAreas).mockResolvedValue([
      anArea('home', 'house', null),
      anArea('upstairs', 'floor', 'home', { name: 'Upstairs', level: 1 }),
      anArea('ground', 'floor', 'home', { name: 'Ground', level: 0 }),
      anArea('study', 'room', 'upstairs', { name: 'Study' }),
      anArea('garage', 'room', 'ground', { name: 'Garage' }),
    ]);
    vi.mocked(fetchDevices).mockResolvedValue([
      { ...PRINTER, areaKey: 'study', areaName: 'Study' },
      RELAY,
    ]);

    renderPage();
    await rowOf('Workshop printer');

    fireEvent.click(screen.getByRole('button', { name: /Filter/u }));
    fireEvent.click(await screen.findByRole('combobox', { name: /^Area/u }));

    await waitFor(() => {
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
        'Any area',
        'Garage',
        'Study',
      ]);
    });
  });
});
