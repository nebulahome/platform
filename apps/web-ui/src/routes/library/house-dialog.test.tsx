/**
 * The house dialog: a name with its icon, and where the house stands.
 *
 * The API and the map are stood in for. What is checked is what the dialog sends, and that it
 * tells the page whether the house moved - which is what decides whether the map around it is
 * fetched again.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AreaView } from '@nebula-home/contracts';

import { createArea, deleteArea, fetchIcons, updateArea } from '@/library/api';

import { HouseDialog, type HouseDialogTarget } from './house-dialog';
import type { HouseMapProps } from './house-map';

vi.mock('@/library/api', () => ({
  createArea: vi.fn(),
  updateArea: vi.fn(),
  deleteArea: vi.fn(),
  fetchIcons: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    areas: ['library', 'areas'],
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

const HOUSE_ID = '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f';

const HOME: AreaView = {
  id: HOUSE_ID,
  key: 'home',
  name: 'Home',
  kind: 'house',
  parentId: null,
  icon: null,
  sortOrder: 100,
  level: null,
  latitude: 45.4642,
  longitude: 9.19,
  deviceCount: 0,
  entityCount: 0,
};

/**
 * Renders the dialog.
 *
 * @param target - What it is for.
 * @returns The callbacks it was given.
 */
function renderDialog(target: HouseDialogTarget) {
  const onSaved = vi.fn();
  const onDeleted = vi.fn();
  const onClose = vi.fn();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <HouseDialog
        target={target}
        removal={{ floors: 1, rooms: 2, devices: 3 }}
        onClose={onClose}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    </QueryClientProvider>,
  );

  return { onSaved, onDeleted, onClose };
}

beforeEach(() => {
  vi.mocked(createArea).mockClear();
  vi.mocked(updateArea).mockClear();
  vi.mocked(deleteArea).mockClear();
  vi.mocked(fetchIcons).mockResolvedValue([]);
});

describe('HouseDialog', () => {
  it('makes the house where the map was clicked, and says it was placed', async () => {
    vi.mocked(createArea).mockResolvedValue(HOME);

    const { onSaved } = renderDialog({ mode: 'create' });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Home' } });
    fireEvent.click(screen.getByRole('button', { name: 'Place in Milan' }));

    expect(screen.getByLabelText<HTMLInputElement>('Latitude').value).toBe('45.4642');
    expect(screen.getByLabelText<HTMLInputElement>('Longitude').value).toBe('9.19');

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createArea).toHaveBeenCalledWith({
        kind: 'house',
        name: 'Home',
        icon: 'house',
        latitude: 45.4642,
        longitude: 9.19,
      });
      expect(onSaved).toHaveBeenCalledWith(HOME, true);
    });
  });

  it('offers no icon: the house is always drawn as a house', () => {
    renderDialog({ mode: 'create' });

    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /change icon/iu })).toBeNull();
  });

  it('makes a house nowhere in particular, to be placed later', async () => {
    vi.mocked(createArea).mockResolvedValue({ ...HOME, latitude: null, longitude: null });

    const { onSaved } = renderDialog({ mode: 'create' });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Home' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createArea).toHaveBeenCalledWith({ kind: 'house', name: 'Home', icon: 'house' });
      expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ latitude: null }), false);
    });
  });

  it('moves the house from the typed coordinates, and says so', async () => {
    vi.mocked(updateArea).mockResolvedValue({ ...HOME, latitude: 41.9, longitude: 12.5 });

    const { onSaved } = renderDialog({ mode: 'edit', house: HOME });

    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '41.9' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '12.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateArea).toHaveBeenCalledWith(HOUSE_ID, { latitude: 41.9, longitude: 12.5 });
      expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ latitude: 41.9 }), true);
    });
  });

  it('sends a rename alone, and says the house did not move', async () => {
    vi.mocked(updateArea).mockResolvedValue({ ...HOME, name: 'Casa' });

    const { onSaved } = renderDialog({ mode: 'edit', house: HOME });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Casa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateArea).toHaveBeenCalledWith(HOUSE_ID, { name: 'Casa' });
      expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: 'Casa' }), false);
    });
  });

  it('refuses half a position, and one off the globe, before asking the server', () => {
    renderDialog({ mode: 'edit', house: HOME });

    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('alert').textContent).toContain('both');

    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '181' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('alert').textContent).toContain('180');
    expect(updateArea).not.toHaveBeenCalled();
  });

  it('removes the house after a second press, saying what goes with it', async () => {
    vi.mocked(deleteArea).mockResolvedValue(undefined);

    const { onDeleted } = renderDialog({ mode: 'edit', house: HOME });

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(screen.getByRole('alert').textContent).toContain('1 floor and 2 rooms go with it');

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1) ?? document.body);

    await waitFor(() => {
      expect(deleteArea).toHaveBeenCalledWith(HOUSE_ID);
      expect(onDeleted).toHaveBeenCalledWith(HOUSE_ID);
    });
  });
});
