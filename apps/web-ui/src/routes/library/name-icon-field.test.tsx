/**
 * The name with its icon beside it: one field, one label, two things to set.
 *
 * The catalogue is stood in for, because the interest is in the field asking it for the one
 * icon it shows and handing back what was picked from it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { IconView } from '@nebula-home/contracts';

import { fetchIcons } from '@/library/api';

import { NameIconField } from './name-icon-field';

vi.mock('@/library/api', () => ({
  fetchIcons: vi.fn(),
  LIBRARY_QUERY_KEYS: { icons: ['library', 'icons'] },
}));

/**
 * An icon as the catalogue serves it.
 *
 * @param id - Its id.
 * @returns The icon.
 */
function iconView(id: string): IconView {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    keywords: [],
    origin: 'builtin',
    isOverridden: false,
    node: [['circle', { cx: '12', cy: '12', r: '4' }]],
    frame: { x: 0, y: 0, size: 24 },
  };
}

/**
 * Renders the field inside what it needs.
 *
 * @param icon - The icon it starts with.
 * @returns The callbacks it was given.
 */
function renderField(icon: string | null = 'printer') {
  const onChange = vi.fn();
  const onIconChange = vi.fn();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <NameIconField value="Workshop" onChange={onChange} icon={icon} onIconChange={onIconChange} />
    </QueryClientProvider>,
  );

  return { onChange, onIconChange };
}

beforeAll(() => {
  vi.mocked(fetchIcons).mockImplementation((request) =>
    Promise.resolve(
      request.ids !== undefined
        ? request.ids.map(iconView)
        : ['printer', 'lightbulb']
            .filter((id) => request.q === undefined || id.includes(request.q))
            .map(iconView),
    ),
  );
});

describe('NameIconField', () => {
  it('labels the input Name, and reports what is typed', () => {
    const { onChange } = renderField();
    const input = screen.getByLabelText<HTMLInputElement>('Name');

    expect(input.value).toBe('Workshop');

    fireEvent.change(input, { target: { value: 'Workshop printer' } });

    expect(onChange).toHaveBeenCalledWith('Workshop printer');
  });

  it('draws the icon and the name as one control', () => {
    renderField();

    const input = screen.getByLabelText('Name');
    const button = screen.getByRole('button', { name: /change icon/iu });
    const control = input.parentElement;

    // One box with the icon at its left edge, not a square beside a field. So the wrapper is what
    // takes the border and the focus ring, and the two things inside it draw no edge of their own.
    expect(control).toBe(button.parentElement);
    expect(control?.className).toContain('focus-within:ring-3');
    expect(input.className).not.toContain('border');
    expect(button.className).not.toContain('rounded-field');
  });

  it('shows the current icon on the button beside the name, by name for a reader', async () => {
    renderField();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /change icon/iu }).textContent).toContain(
        'Printer',
      );
    });
  });

  it('opens the catalogue from the button and hands back what was picked', async () => {
    const { onIconChange } = renderField();

    fireEvent.click(screen.getByRole('button', { name: /change icon/iu }));
    fireEvent.change(await screen.findByLabelText('Search icons'), {
      target: { value: 'light' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Lightbulb' }));

    expect(onIconChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'lightbulb' }));
  });

  it('shows an empty tile, and says so, when there is no icon', () => {
    renderField(null);

    expect(screen.getByRole('button', { name: /change icon/iu }).textContent).toContain('None');
  });
});
