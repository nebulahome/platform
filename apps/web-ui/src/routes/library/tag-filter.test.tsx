/**
 * The tags filter: the colour list shows its colours, and the usage words are not doubled up.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TagFilterButton } from './tag-filter';

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
