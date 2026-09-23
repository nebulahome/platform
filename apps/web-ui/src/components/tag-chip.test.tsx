/**
 * The tag chip: an icon in one of twelve colours, its name for whoever hovers or reads, and a
 * cross only when it can be taken off.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TagChip } from '@nebula-home/ui';

describe('TagChip', () => {
  it('shows the name, and carries its colour as a class the theme can restyle', () => {
    const { container } = render(<TagChip color="teal">Exterior</TagChip>);

    expect(screen.getByText('Exterior')).toBeTruthy();
    expect(container.firstElementChild?.className).toContain('text-tag-teal');
  });

  it('draws the icon the tag was given', () => {
    const { container } = render(
      <TagChip
        color="teal"
        icon={{
          node: [['rect', { x: '2', y: '2', width: '20', height: '20' }]],
          frame: { x: 0, y: 0, size: 24 },
        }}
      >
        Exterior
      </TagChip>,
    );

    expect(container.querySelector('svg rect')).toBeTruthy();
  });

  it('draws the tag glyph when the tag has no icon of its own', () => {
    const { container } = render(<TagChip color="teal">Exterior</TagChip>);

    // The interface's own `tag` drawing, so every chip has a glyph and a row of chips reads as
    // a row of glyphs whether or not the owner chose one.
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.querySelector('svg rect')).toBeNull();
  });

  it('shows the name beside the icon, open, unless told to open on hover', () => {
    render(<TagChip color="teal">Exterior</TagChip>);
    const name = screen.getByText('Exterior');

    // On the tags page and in a tag field there is room for the word, and a chip that has to be
    // hovered to be read is a chip nobody reads.
    expect(name.parentElement?.className).not.toContain('max-w-0');
    expect(name.parentElement?.className).not.toContain('group-hover:');
  });

  it('keeps the name for a reader, and shows it to a pointer only on hover, in a dense row', () => {
    const { container } = render(
      <TagChip color="teal" reveal="hover">
        Exterior
      </TagChip>,
    );
    const name = screen.getByText('Exterior');

    expect(container.firstElementChild?.getAttribute('title')).toBe('Exterior');
    expect(name.parentElement?.className).toContain('max-w-0');
    expect(name.parentElement?.className).toContain('group-hover:');
    expect(name.parentElement?.className).toContain('group-focus-within:');
  });

  it('has no cross unless something can take it off', () => {
    render(<TagChip color="teal">Exterior</TagChip>);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names the cross after the tag, and presses it', () => {
    const onRemove = vi.fn();

    render(
      <TagChip color="pink" onRemove={onRemove}>
        Exterior
      </TagChip>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove Exterior' }));

    expect(onRemove).toHaveBeenCalledOnce();
  });
});
