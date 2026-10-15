/**
 * The icons settings: the catalogue listed, a built-in icon redrawn, a custom one added.
 *
 * The API module is stood in for. What is asserted is what the page lets an owner change about
 * each kind of icon, what an upload turns into, and what is sent when it is saved.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IconView } from '@nebulahome/contracts';

import { useSession } from '@/auth/session-store';
import { createIcon, deleteIcon, fetchIcons, updateIcon } from '@/library/api';

import { IconsPanel } from './icons-panel';

vi.mock('@/library/api', () => ({
  fetchIcons: vi.fn(),
  createIcon: vi.fn(),
  updateIcon: vi.fn(),
  deleteIcon: vi.fn(),
  LIBRARY_QUERY_KEYS: { icons: ['library', 'icons'] },
}));

/** A drawing an owner might upload: a square in a big box, off centre. */
const BIG_SVG = '<svg viewBox="0 0 512 512"><path d="M64 64h256v256H64z"/></svg>';

/**
 * An icon as the catalogue serves it.
 *
 * @param fields - What differs from a plain built-in icon.
 * @returns The icon.
 */
function icon(fields: Partial<IconView> & { readonly id: string }): IconView {
  return {
    name: fields.id.charAt(0).toUpperCase() + fields.id.slice(1),
    keywords: [],
    origin: 'builtin',
    isOverridden: false,
    node: [['circle', { cx: '12', cy: '12', r: '4' }]],
    frame: { x: 0, y: 0, size: 24 },
    ...fields,
  };
}

const CATALOGUE: IconView[] = [
  icon({ id: 'settings' }),
  icon({ id: 'lightbulb', keywords: ['idea'] }),
  icon({ id: 'printer', isOverridden: true }),
  icon({ id: 'boiler', name: 'Boiler', origin: 'custom' }),
];

/**
 * Renders the panel with an owner signed in.
 *
 * @param permissions - What the owner may do.
 */
function renderPanel(permissions = ['settings:read', 'settings:write']): void {
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
      houseLocale: 'en',
      timezone: 'Europe/Rome',
      isTwoFactorEnabled: false,
      mustChangePassword: false,
    },
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <IconsPanel />
    </QueryClientProvider>,
  );
}

/**
 * Uploads a drawing into the editor.
 *
 * @param markup - The file's text.
 */
async function upload(markup: string): Promise<void> {
  const file = new File([markup], 'boiler.svg', { type: 'image/svg+xml' });

  fireEvent.change(screen.getByLabelText('Drawing'), { target: { files: [file] } });

  await waitFor(() => {
    expect(screen.getByTestId('icon-preview')).toBeTruthy();
  });
}

beforeAll(() => {
  // jsdom has no layout, so it cannot measure a drawing. The square above is 256 wide at 64.
  Object.defineProperty(globalThis.SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: () => ({ x: 64, y: 64, width: 256, height: 256 }),
  });
});

beforeEach(() => {
  vi.mocked(fetchIcons).mockImplementation((request) =>
    Promise.resolve(
      CATALOGUE.filter(
        (each) =>
          request.q === undefined || request.q === '' || each.id.includes(request.q.toLowerCase()),
      ),
    ),
  );
  vi.mocked(createIcon).mockClear();
  vi.mocked(updateIcon).mockClear();
  vi.mocked(deleteIcon).mockClear();
});

describe('IconsPanel', () => {
  it('lists the catalogue, saying which icons the interface uses and which were changed', async () => {
    renderPanel();

    const settings = await screen.findByRole('button', { name: /Settings/u });

    expect(settings.textContent).toContain('Interface');
    expect(screen.getByRole('button', { name: /Printer/u }).textContent).toContain('Modified');
    expect(screen.getByRole('button', { name: /Boiler/u }).textContent).toContain('Custom');

    fireEvent.change(screen.getByLabelText('Search icons'), { target: { value: 'light' } });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Settings/u })).toBeNull();
    });
    expect(await screen.findByRole('button', { name: /Lightbulb/u })).toBeTruthy();
  });

  it('lays the catalogue out as tiles, the way the picker does', async () => {
    renderPanel();

    const list = await screen.findByRole('list', { name: 'Icons' });
    const tile = screen.getByRole('button', { name: /Printer/u });

    // A catalogue is scanned by glyph, not read by name: a grid of tiles shows thirty at a
    // glance where a list of rows shows eight.
    expect(list.className).toContain('grid');
    expect(tile.className).toContain('flex-col');
    expect(tile.textContent).toContain('printer');
  });

  it('locks the name and the id of a built-in icon, and takes a new drawing for it', async () => {
    vi.mocked(updateIcon).mockResolvedValue(icon({ id: 'lightbulb', isOverridden: true }));
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /Lightbulb/u }));

    expect(screen.getByLabelText<HTMLInputElement>('Name').readOnly).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>('Id').readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: 'Reset to default' })).toBeNull();

    await upload(BIG_SVG);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateIcon).toHaveBeenCalledWith('lightbulb', {
        keywords: ['idea'],
        svg: BIG_SVG,
        frame: { x: 38.4, y: 38.4, size: 307.2 },
      });
    });
  });

  it('suggests an id from the name of a new icon, fits the upload to the guides, and saves it', async () => {
    vi.mocked(createIcon).mockResolvedValue(icon({ id: 'heat-pump', origin: 'custom' }));
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'New icon' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Heat pump' } });

    expect(screen.getByLabelText<HTMLInputElement>('Id').value).toBe('heat-pump');

    fireEvent.change(screen.getByLabelText('Keywords'), { target: { value: 'heating, hvac' } });
    await upload(BIG_SVG);

    // The square is 256 wide at 64: fitted, it fills the inner 20 of the 24 box, centred.
    // 256 * 24 / 20 = 307.2 wide, so the frame starts 25.6 before the square.
    expect(screen.getByTestId('icon-preview').getAttribute('viewBox')).toBe(
      '38.4 38.4 307.2 307.2',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createIcon).toHaveBeenCalledWith({
        id: 'heat-pump',
        name: 'Heat pump',
        keywords: ['heating', 'hvac'],
        svg: BIG_SVG,
        frame: { x: 38.4, y: 38.4, size: 307.2 },
      });
    });
  });

  it('puts the original drawing back for an icon that was changed', async () => {
    vi.mocked(deleteIcon).mockResolvedValue(undefined);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /Printer/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));

    await waitFor(() => {
      expect(deleteIcon).toHaveBeenCalledWith('printer');
    });
  });

  it('lets a custom icon be renamed, and removed', async () => {
    vi.mocked(updateIcon).mockResolvedValue(
      icon({ id: 'boiler', name: 'Combi', origin: 'custom' }),
    );
    vi.mocked(deleteIcon).mockResolvedValue(undefined);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /Boiler/u }));

    expect(screen.getByLabelText<HTMLInputElement>('Name').readOnly).toBe(false);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Combi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateIcon).toHaveBeenCalledWith('boiler', { name: 'Combi', keywords: [] });
    });

    fireEvent.click(await screen.findByRole('button', { name: /Boiler|Combi/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(deleteIcon).toHaveBeenCalledWith('boiler');
    });
  });

  it('shows the catalogue read-only to somebody who may not change the server', async () => {
    renderPanel(['settings:read']);

    await screen.findByRole('button', { name: /Settings/u });

    expect(screen.queryByRole('button', { name: 'New icon' })).toBeNull();
  });
});
