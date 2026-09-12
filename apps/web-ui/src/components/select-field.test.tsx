/**
 * The dropdown, which is only worth writing because it is no longer the browser's.
 *
 * Everything here was free while this was a `<select>`. Replacing it means each of those
 * behaviours is now something that can be broken by an edit and noticed by nobody, because a
 * dropdown that has stopped answering the arrow keys still looks completely fine in a
 * screenshot. That is what these cases are for.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SelectField } from '@nebula-home/ui';

/** Four options with distinct initials, so typeahead has something to be right about. */
const OPTIONS = [
  { value: 'celsius', label: 'Celsius' },
  { value: 'fahrenheit', label: 'Fahrenheit' },
  { value: 'kelvin', label: 'Kelvin' },
  { value: 'rankine', label: 'Rankine' },
];

/**
 * Renders a dropdown and hands back the button and the change spy.
 *
 * @param value - Which option starts chosen.
 * @returns The combobox and the spy.
 */
function renderSelect(value = 'celsius') {
  const onChange = vi.fn();

  render(<SelectField label="Temperature" options={OPTIONS} value={value} onChange={onChange} />);

  return { combobox: screen.getByRole('combobox'), onChange };
}

describe('SelectField', () => {
  it('shows the chosen option without opening anything', () => {
    const { combobox } = renderSelect('fahrenheit');

    expect(combobox.textContent).toContain('Fahrenheit');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('announces itself as a closed combobox that owns a list', () => {
    const { combobox } = renderSelect();

    expect(combobox.getAttribute('aria-haspopup')).toBe('listbox');
    expect(combobox.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on a click and marks the chosen option as selected', () => {
    const { combobox } = renderSelect('kelvin');

    fireEvent.click(combobox);

    const options = screen.getAllByRole('option');

    expect(options).toHaveLength(4);
    expect(options[2]?.getAttribute('aria-selected')).toBe('true');
    expect(options[0]?.getAttribute('aria-selected')).toBe('false');
  });

  it('opens on the down arrow, as the native control does', () => {
    const { combobox } = renderSelect();

    fireEvent.keyDown(combobox, { key: 'ArrowDown' });

    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(combobox.getAttribute('aria-expanded')).toBe('true');
  });

  it('names the active option rather than moving focus to it', () => {
    // The focus ring has to stay on the button: that is what `aria-activedescendant` is for, and
    // a list that steals focus loses the ring somewhere nobody can see it.
    const { combobox } = renderSelect();

    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });

    const active = combobox.getAttribute('aria-activedescendant');

    expect(active).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Fahrenheit' }).id).toBe(active);
  });

  it('wraps at the end rather than stopping', () => {
    const { combobox } = renderSelect('rankine');

    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });

    expect(combobox.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Celsius' }).id,
    );
  });

  it('jumps to the last option on End and the first on Home', () => {
    const { combobox } = renderSelect();

    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.keyDown(combobox, { key: 'End' });

    expect(combobox.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Rankine' }).id,
    );

    fireEvent.keyDown(combobox, { key: 'Home' });

    expect(combobox.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Celsius' }).id,
    );
  });

  it('chooses with Enter and closes', () => {
    const { combobox, onChange } = renderSelect();

    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.keyDown(combobox, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('fahrenheit');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('chooses on a click', () => {
    const { combobox, onChange } = renderSelect();

    fireEvent.click(combobox);
    fireEvent.click(screen.getByRole('option', { name: 'Kelvin' }));

    expect(onChange).toHaveBeenCalledWith('kelvin');
  });

  it('closes on Escape without choosing anything', () => {
    const { combobox, onChange } = renderSelect();

    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.keyDown(combobox, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes on Tab rather than swallowing it', () => {
    // A dropdown that keeps Tab is a keyboard trap, which is the one failure that makes a page
    // unusable rather than merely awkward.
    const { combobox } = renderSelect();

    fireEvent.click(combobox);
    fireEvent.keyDown(combobox, { key: 'Tab' });

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('picks straight from a letter while closed', () => {
    const { combobox, onChange } = renderSelect();

    fireEvent.keyDown(combobox, { key: 'k' });

    expect(onChange).toHaveBeenCalledWith('kelvin');
  });

  it('builds a search from letters typed together', () => {
    // `r` alone is Rankine. `ra` is still Rankine, but the point is that the second letter
    // extends the search rather than starting a new one - which is what separates this from
    // jumping between the two options that begin with the same letter.
    const { combobox } = renderSelect();

    fireEvent.click(combobox);
    fireEvent.keyDown(combobox, { key: 'f' });

    expect(combobox.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Fahrenheit' }).id,
    );
  });

  it('ignores a letter that names nothing', () => {
    const { combobox, onChange } = renderSelect();

    fireEvent.keyDown(combobox, { key: 'z' });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does nothing at all when disabled', () => {
    const onChange = vi.fn();

    render(
      <SelectField
        label="Temperature"
        options={OPTIONS}
        value="celsius"
        onChange={onChange}
        disabled
      />,
    );

    const combobox = screen.getByRole('combobox');

    fireEvent.keyDown(combobox, { key: 'ArrowDown' });

    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
