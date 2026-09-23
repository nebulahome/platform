/**
 * The tag dialog: a name with its icon, a colour, and - for a tag that exists - a way to delete
 * it.
 *
 * The catalogue is stood in for: the interest is in what the dialog sends, not in what it draws.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IconView, TagView } from '@nebula-home/contracts';

import { createTag, deleteTag, fetchIcons, updateTag } from '@/library/api';

import { TagDialog } from './tag-dialog';

vi.mock('@/library/api', () => ({
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  fetchIcons: vi.fn(),
  LIBRARY_QUERY_KEYS: {
    tags: ['library', 'tags'],
    devices: ['library', 'devices'],
    entities: ['library', 'entities'],
    icons: ['library', 'icons'],
  },
}));

/** The one icon the stand-in catalogue offers. */
const SUN: IconView = {
  id: 'sun',
  name: 'Sun',
  keywords: [],
  origin: 'builtin',
  isOverridden: false,
  node: [['circle', { cx: '12', cy: '12', r: '4' }]],
  frame: { x: 0, y: 0, size: 24 },
};

const EXTERIOR: TagView = {
  id: '018f1c2e-4a5b-7c8d-9e0f-1a2b3c4d5e6f',
  key: 'exterior',
  name: 'Exterior',
  color: 'green',
  icon: null,
  deviceCount: 2,
  entityCount: 3,
};

/**
 * Renders the dialog.
 *
 * @param target - What it is for.
 * @returns The callbacks it was given.
 */
function renderDialog(target: Parameters<typeof TagDialog>[0]['target']) {
  const onSaved = vi.fn();
  const onDeleted = vi.fn();
  const onClose = vi.fn();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <TagDialog target={target} onClose={onClose} onSaved={onSaved} onDeleted={onDeleted} />
    </QueryClientProvider>,
  );

  return { onSaved, onDeleted, onClose };
}

beforeEach(() => {
  vi.mocked(createTag).mockClear();
  vi.mocked(updateTag).mockClear();
  vi.mocked(deleteTag).mockClear();
  vi.mocked(fetchIcons).mockResolvedValue([SUN]);
});

describe('making a tag', () => {
  it('sends the name and the colour picked, and hands back what came back', async () => {
    vi.mocked(createTag).mockResolvedValue({ ...EXTERIOR, name: 'Garden', color: 'lime' });

    const { onSaved } = renderDialog({ mode: 'create' });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Garden ' } });
    fireEvent.click(screen.getByRole('radio', { name: 'lime' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createTag).toHaveBeenCalledWith({ name: 'Garden', color: 'lime' });
      expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: 'Garden' }));
    });
  });

  it('offers an icon beside the name, and sends the one picked', async () => {
    vi.mocked(createTag).mockResolvedValue({ ...EXTERIOR, name: 'Garden', icon: 'sun' });

    renderDialog({ mode: 'create' });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Garden' } });
    fireEvent.click(screen.getByRole('button', { name: /change icon/iu }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sun' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createTag).toHaveBeenCalledWith({ name: 'Garden', color: 'red', icon: 'sun' });
    });
  });

  it('sends a changed icon on its own', async () => {
    vi.mocked(updateTag).mockResolvedValue({ ...EXTERIOR, icon: 'sun' });

    renderDialog({ mode: 'edit', tag: EXTERIOR });

    fireEvent.click(screen.getByRole('button', { name: /change icon/iu }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sun' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateTag).toHaveBeenCalledWith(EXTERIOR.id, { icon: 'sun' });
    });
  });

  it('refuses a blank name, and offers no deletion', () => {
    renderDialog({ mode: 'create' });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(createTag).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/name/iu);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});

describe('changing a tag', () => {
  it('starts from the tag, and sends only what changed', async () => {
    vi.mocked(updateTag).mockResolvedValue({ ...EXTERIOR, color: 'teal' });

    const { onSaved } = renderDialog({ mode: 'edit', tag: EXTERIOR });

    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Exterior');

    fireEvent.click(screen.getByRole('radio', { name: 'teal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateTag).toHaveBeenCalledWith(EXTERIOR.id, { color: 'teal' });
      expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ color: 'teal' }));
    });
  });

  it('deletes after a second press, saying what it comes off, and tells the page', async () => {
    vi.mocked(deleteTag).mockResolvedValue(undefined);

    const { onDeleted } = renderDialog({ mode: 'edit', tag: EXTERIOR });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(deleteTag).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/2 devices and 3 entities/u);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(deleteTag).toHaveBeenCalledWith(EXTERIOR.id);
      expect(onDeleted).toHaveBeenCalledWith(EXTERIOR.id);
    });
  });
});
