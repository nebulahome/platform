/**
 * The tags filter: the colour list shows its colours, the usage words are not doubled up, and a
 * facet set is a chip that takes only itself off.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { activeTagFilters, TagFilterButton } from './tag-filter';

/**
 * Renders the filter and opens its sheet.
 *
 * @returns The change spy.
 */
function renderOpen() {
  const onChange = vi.fn();

  render(<TagFilterButton filter={{ search: '', color: '', usage: 'any' }} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /Filter/u }));

  return { onChange };
}

describe('TagFilterButton', () => {
  it('shows each colour beside its name', () => {
    renderOpen();

    fireEvent.click(screen.getByRole('combobox', { name: /Colour/u }));

    // A name alone asks the reader to know what "teal" looks like; the dot shows them.
    expect(screen.getByRole('option', { name: 'Teal' }).querySelector('.bg-tag-teal')).toBeTruthy();
    expect(
      screen.getByRole('option', { name: 'Any colour' }).querySelector('[class*="bg-tag-"]'),
    ).toBeNull();
  });

  it('names what a tag is on without repeating the facet', () => {
    const { onChange } = renderOpen();

    // The facet is already titled "On"; "On devices" under it read "ON On devices".
    expect(screen.getByRole('radio', { name: 'Devices' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Entities' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /^On /u })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Nothing' }));

    expect(onChange).toHaveBeenCalledWith({ search: '', color: '', usage: 'unused' });
  });
});

describe('activeTagFilters', () => {
  it('has no chip when nothing is set, the search aside', () => {
    expect(activeTagFilters({ search: 'gar', color: '', usage: 'any' }, vi.fn())).toEqual([]);
  });

  it('names each facet set, and removes only its own', () => {
    const onChange = vi.fn();
    const filter = { search: 'gar', color: 'teal', usage: 'unused' } as const;
    const chips = activeTagFilters(filter, onChange);

    expect(chips.map((chip) => [chip.key, chip.value])).toEqual([
      ['Colour', 'Teal'],
      ['On', 'Nothing'],
    ]);

    chips[0]?.onRemove();
    expect(onChange).toHaveBeenLastCalledWith({ ...filter, color: '' });

    chips[1]?.onRemove();
    expect(onChange).toHaveBeenLastCalledWith({ ...filter, usage: 'any' });
  });
});
