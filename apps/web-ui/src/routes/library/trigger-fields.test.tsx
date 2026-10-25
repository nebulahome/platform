/**
 * The Time block's At: Quietest switches to the quiet trigger and edits its offset.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TriggerFields } from './trigger-fields';

describe('TriggerFields, the quietest time', () => {
  it('switches a time of day to the quiet trigger', () => {
    const onChange = vi.fn();

    render(
      <TriggerFields
        trigger={{ type: 'time', at: { kind: 'clock', time: '07:00' } }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Quietest' }));

    expect(onChange).toHaveBeenCalledWith({ type: 'quiet' });
  });

  it('edits the offset, and drops it at zero', () => {
    const onChange = vi.fn();

    render(<TriggerFields trigger={{ type: 'quiet', offsetMinutes: 30 }} onChange={onChange} />);

    const offset = screen.getByRole('spinbutton', { name: /Offset/ });

    fireEvent.change(offset, { target: { value: '-45' } });
    fireEvent.change(offset, { target: { value: '0' } });

    expect(onChange).toHaveBeenNthCalledWith(1, { type: 'quiet', offsetMinutes: -45 });
    expect(onChange).toHaveBeenNthCalledWith(2, { type: 'quiet' });
  });
});
