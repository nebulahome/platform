/**
 * The areas page: the house, its floors, their rooms, and the map kept around the house.
 *
 * The API and the map are stood in for. What is checked is what the page shows for a house
 * that is and is not there, who gets which buttons, that placing the house is what fetches the
 * map around it, and that a map left half-fetched is finished without a button.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AreaView } from '@nebula-home/contracts';

import { useSession } from '@/auth/session-store';
import { createArea, fetchAreas, fetchIcons, fetchTileStatus, prefetchTiles } from '@/library/api';

import { AreasPage } from './areas-page';
import type { HouseMapProps } from './house-map';

vi.mock('@/library/api', () => ({
  fetchAreas: vi.fn(),
  createArea: vi.fn(),
  updateArea: vi.fn(),
  deleteArea: vi.fn(),
  fetchTileStatus: vi.fn(),
  prefetchTiles: vi.fn(),
  fetchIcons: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    areas: ['library', 'areas'],
    tiles: ['library', 'tiles'],
    devices: ['library', 'devices'],
    entities: ['library', 'entities'],
    icons: ['library', 'icons'],
  },
}));

vi.mock('./house-map', () => ({
  /**
   * A map with one place on it.
   *
   * @param props - What the real map takes.
   * @returns A button that places the house in Milan.
   */
  // eslint-disable-next-line @typescript-eslint/naming-convention -- a component's export
  HouseMap: (props: HouseMapProps) => (
    <button
      type="button"
      onClick={() => {
        props.onChange({ latitude: 45.4642, longitude: 9.19 });
      }}
    >
      Place in Milan
    </button>
  ),
}));

/**
 * An area as the API serves it.
 *
 * @param id - Its id.
 * @param kind - House, floor or room.
 * @param name - What it is called.
 * @param parentId - What it is in.
 * @param deviceCount - How many devices are in it.
 * @returns The area.
 */
function area(
  id: string,
  kind: AreaView['kind'],
  name: string,
  parentId: string | null,
  deviceCount = 0,
): AreaView {
  return {
    id,
    key: id.replaceAll('-', '_'),
    name,
    kind,
    parentId,
    icon: null,
    sortOrder: 100,
    level: kind === 'floor' ? 0 : null,
    latitude: kind === 'house' ? 45.4642 : null,
    longitude: kind === 'house' ? 9.19 : null,
    deviceCount,
    entityCount: 0,
  };
}

const HOUSE_ID = '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f';
const FLOOR_ID = '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e70';
const ROOM_ID = '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e71';
const HOME = area(HOUSE_ID, 'house', 'Home', null);
const GROUND = area(FLOOR_ID, 'floor', 'Ground floor', HOUSE_ID);
const KITCHEN = area(ROOM_ID, 'room', 'Kitchen', FLOOR_ID, 2);

/**
 * Renders the page with somebody signed in.
 *
 * @param permissions - What they hold.
 */
function renderPage(permissions: string[] = ['area:read', 'area:write']): void {
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
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/areas']}>
        <AreasPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(fetchAreas).mockReset();
  vi.mocked(createArea).mockReset();
  vi.mocked(fetchTileStatus).mockReset();
  vi.mocked(prefetchTiles).mockReset();
  vi.mocked(fetchIcons).mockResolvedValue([]);
  vi.mocked(fetchTileStatus).mockResolvedValue({ total: 180, cached: 12 });
});

describe('AreasPage', () => {
  it('asks for the house when there is none, from somebody who may make it', async () => {
    vi.mocked(fetchAreas).mockResolvedValue([]);

    renderPage();

    expect(await screen.findByRole('button', { name: 'Create your house' })).toBeTruthy();
    expect(screen.getByText(/No house yet/u)).toBeTruthy();
  });

  it('keeps the button from somebody who may only read', async () => {
    vi.mocked(fetchAreas).mockResolvedValue([]);

    renderPage(['area:read']);

    expect(await screen.findByText(/No house yet/u)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create your house' })).toBeNull();
  });

  it('shows the house, its floors and their rooms, with what is in each', async () => {
    vi.mocked(fetchAreas).mockResolvedValue([HOME, GROUND, KITCHEN]);

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Home' })).toBeTruthy();
    expect(screen.getByText('Ground floor')).toBeTruthy();
    expect(screen.getByText('Kitchen')).toBeTruthy();
    expect(screen.getByText('2 devices')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add floor' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add room/u })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create your house' })).toBeNull();
  });

  it('finishes a half-fetched map in the background, with a tag and no button', async () => {
    vi.mocked(fetchAreas).mockResolvedValue([HOME]);
    vi.mocked(prefetchTiles).mockResolvedValue({ total: 180, cached: 180, failed: 0 });

    renderPage();

    await waitFor(() => {
      expect(prefetchTiles).toHaveBeenCalledWith(HOUSE_ID);
    });
    expect(prefetchTiles).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /offline map/iu })).toBeNull();
  });

  it('tags a map that is all on disk as cached, and fetches nothing', async () => {
    vi.mocked(fetchAreas).mockResolvedValue([HOME]);
    vi.mocked(fetchTileStatus).mockResolvedValue({ total: 180, cached: 180 });

    renderPage();

    expect(await screen.findByText('Map cached')).toBeTruthy();
    expect(prefetchTiles).not.toHaveBeenCalled();
  });

  it('fetches the map around the house as soon as the house is placed', async () => {
    vi.mocked(fetchAreas).mockResolvedValue([]);
    vi.mocked(createArea).mockResolvedValue(HOME);
    vi.mocked(prefetchTiles).mockResolvedValue({ total: 180, cached: 180, failed: 0 });

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Create your house' }));

    const dialog = within(screen.getByRole('dialog'));

    fireEvent.change(dialog.getByLabelText('Name'), { target: { value: 'Home' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Place in Milan' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(prefetchTiles).toHaveBeenCalledWith(HOUSE_ID);
    });
  });

  it('opens a room for configuring from its row', async () => {
    vi.mocked(fetchAreas).mockResolvedValue([HOME, GROUND, KITCHEN]);

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Configure Kitchen' }));

    expect(screen.getByRole('dialog').textContent).toContain('Configure Kitchen');
  });
});
