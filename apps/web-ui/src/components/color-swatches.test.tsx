/**
 * The palette: twelve swatches, one radio group, the arrow keys moving between them.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TAG_COLORS } from '@nebula-home/contracts';
import { ColorSwatches } from '@nebula-home/ui';

describe('ColorSwatches', () => {
  it('offers every colour of the palette as one radio group', () => {
    render(<ColorSwatches label="Colour" value={null} onChange={vi.fn()} />);

    expect(screen.getByRole('radiogroup', { name: 'Colour' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(TAG_COLORS.length);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'teal' }).checked).toBe(false);
  });

  it('marks the chosen colour, and reports a press on another', () => {
    const onChange = vi.fn();

    render(<ColorSwatches label="Colour" value="teal" onChange={onChange} />);

    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'teal' }).checked).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: 'pink' }));

    expect(onChange).toHaveBeenCalledWith('pink');
  });

  it('disables every swatch when the choice cannot be made', () => {
    // The browser refuses the press on a disabled input; what is asserted is that each one is.
    render(<ColorSwatches label="Colour" value="teal" onChange={vi.fn()} disabled />);

    for (const radio of screen.getAllByRole<HTMLInputElement>('radio')) {
      expect(radio.disabled).toBe(true);
    }
  });
});
