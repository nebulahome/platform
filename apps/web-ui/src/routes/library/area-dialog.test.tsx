/**
 * The floor and room dialog: a name with its icon, and - for one that exists - a way to remove
 * it that says what goes with it.
 *
 * The API is stood in for: the interest is in what the dialog sends and tells the page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AreaView } from '@nebulahome/contracts';

import { createArea, deleteArea, fetchIcons, updateArea } from '@/library/api';

import { AreaDialog, type AreaDialogTarget } from './area-dialog';

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

/**
 * An area as the API serves it.
 *
 * @param id - Its id.
 * @param kind - House, floor or room.
 * @param name - What it is called.
 * @param parentId - What it is in.
 * @returns The area.
 */
function area(
  id: string,
  kind: AreaView['kind'],
  name: string,
  parentId: string | null = null,
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
    latitude: null,
    longitude: null,
    deviceCount: 0,
    entityCount: 0,
  };
}

const HOUSE_ID = '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f';
const FLOOR_ID = '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e70';
const ROOM_ID = '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e71';
const GROUND = area(FLOOR_ID, 'floor', 'Ground floor', HOUSE_ID);
const KITCHEN = { ...area(ROOM_ID, 'room', 'Kitchen', FLOOR_ID), deviceCount: 2 };

/**
 * Renders the dialog.
 *
 * @param target - What it is for.
 * @returns The callbacks it was given.
 */
function renderDialog(target: AreaDialogTarget) {
  const onSaved = vi.fn();
  const onDeleted = vi.fn();
  const onClose = vi.fn();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <AreaDialog
        target={target}
        removal={{ floors: 0, rooms: 0, devices: 2 }}
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

describe('AreaDialog', () => {
  it('makes a room on the floor it was opened from, and hands it back', async () => {
    vi.mocked(createArea).mockResolvedValue(KITCHEN);

    const { onSaved } = renderDialog({ mode: 'create', kind: 'room', parent: GROUND });

    expect(screen.getByRole('dialog').textContent).toContain('New room');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Kitchen ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createArea).toHaveBeenCalledWith({
        kind: 'room',
        name: 'Kitchen',
        parentId: FLOOR_ID,
      });
      expect(onSaved).toHaveBeenCalledWith(KITCHEN);
    });
  });

  it('asks a floor for its name alone, and a room for its icon too', () => {
    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <AreaDialog
          target={{ mode: 'create', kind: 'floor', parent: area(HOUSE_ID, 'house', 'Home') }}
          removal={{ floors: 0, rooms: 0, devices: 0 }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          onDeleted={vi.fn()}
        />
      </QueryClientProvider>,
    );

    // A floor is a level, not a thing with a look of its own.
    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /change icon/iu })).toBeNull();

    unmount();
    renderDialog({ mode: 'create', kind: 'room', parent: GROUND });

    expect(screen.getByRole('button', { name: /change icon/iu })).toBeTruthy();
  });

  it('makes a floor on the first free number, and sends it', async () => {
    vi.mocked(createArea).mockResolvedValue({ ...GROUND, id: 'first', level: 1 });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AreaDialog
          target={{ mode: 'create', kind: 'floor', parent: area(HOUSE_ID, 'house', 'Home') }}
          removal={{ floors: 0, rooms: 0, devices: 0 }}
          floors={[GROUND]}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          onDeleted={vi.fn()}
        />
      </QueryClientProvider>,
    );

    // The ground floor is 0, so a new one starts above it.
    expect(screen.getByLabelText<HTMLInputElement>('Floor number').value).toBe('1');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'First floor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createArea).toHaveBeenCalledWith({
        kind: 'floor',
        name: 'First floor',
        parentId: HOUSE_ID,
        level: 1,
      });
    });
  });

  it('refuses a floor number another floor has, naming it, before asking the server', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AreaDialog
          target={{ mode: 'create', kind: 'floor', parent: area(HOUSE_ID, 'house', 'Home') }}
          removal={{ floors: 0, rooms: 0, devices: 0 }}
          floors={[GROUND]}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          onDeleted={vi.fn()}
        />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mezzanine' } });
    fireEvent.change(screen.getByLabelText('Floor number'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByText('Ground floor is already floor 0.')).toBeTruthy();
    expect(createArea).not.toHaveBeenCalled();
  });

  it('lets a floor keep its own number when it is renamed', async () => {
    vi.mocked(updateArea).mockResolvedValue({ ...GROUND, name: 'Ground' });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AreaDialog
          target={{ mode: 'edit', area: GROUND }}
          removal={{ floors: 0, rooms: 0, devices: 0 }}
          floors={[GROUND]}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          onDeleted={vi.fn()}
        />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ground' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateArea).toHaveBeenCalledWith(FLOOR_ID, { name: 'Ground' });
    });
  });

  it('refuses a blank name before asking the server', () => {
    renderDialog({ mode: 'create', kind: 'floor', parent: area(HOUSE_ID, 'house', 'Home') });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByRole('alert').textContent).toContain('name');
    expect(createArea).not.toHaveBeenCalled();
  });

  it('starts from the area, and sends only what changed', async () => {
    vi.mocked(updateArea).mockResolvedValue({ ...KITCHEN, name: 'Scullery' });

    const { onSaved } = renderDialog({ mode: 'edit', area: KITCHEN });

    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Kitchen');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Scullery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateArea).toHaveBeenCalledWith(ROOM_ID, { name: 'Scullery' });
      expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: 'Scullery' }));
    });
  });

  it('removes after a second press, saying what is left in no room, and tells the page', async () => {
    vi.mocked(deleteArea).mockResolvedValue(undefined);

    const { onDeleted } = renderDialog({ mode: 'edit', area: KITCHEN });

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(screen.getByRole('alert').textContent).toContain('2 devices are left in no room');

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1) ?? document.body);

    await waitFor(() => {
      expect(deleteArea).toHaveBeenCalledWith(ROOM_ID);
      expect(onDeleted).toHaveBeenCalledWith(ROOM_ID);
    });
  });
});
