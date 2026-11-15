import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Calendar, dayKey, formatDay, shiftDay } from './calendar.js';
import { Tooltip } from './tooltip.js';

describe('a day’s key', () => {
  it('carries what overflows a month and a year', () => {
    expect(dayKey(2026, 6, 21)).toBe('2026-06-21');
    expect(dayKey(2026, 3, 0)).toBe('2026-02-28');
    expect(dayKey(2026, 13, 1)).toBe('2027-01-01');
  });

  it('moves by days across a month, a year and a change of clocks', () => {
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-03-28', 7)).toBe('2026-04-04');
  });

  it('is written in words, and left as it came when it is not a day', () => {
    expect(formatDay('2026-06-21', 'en-GB')).toBe('21 Jun 2026');
    expect(formatDay('soon', 'en-GB')).toBe('soon');
  });
});

describe('Calendar', () => {
  it('hands back the day pressed, and keeps days outside its bounds from being picked', () => {
    const onChange = vi.fn();

    render(<Calendar value="2026-06-21" min="2026-06-10" onChange={onChange} />);

    expect(screen.getByRole('button', { name: 'Tuesday, June 9, 2026' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sunday, June 21, 2026' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Monday, June 22, 2026' }));
    expect(onChange).toHaveBeenCalledWith('2026-06-22');
  });

  it('moves the keyboard’s day with the arrows, into the next month and not past a bound', () => {
    render(<Calendar value="2026-06-30" max="2026-07-05" onChange={vi.fn()} />);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Tuesday, June 30, 2026' }), {
      key: 'ArrowRight',
    });
    expect(screen.getByRole('button', { name: 'Wednesday, July 1, 2026' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Wednesday, July 1, 2026' }), {
      key: 'ArrowDown',
    });
    expect(screen.getByRole('button', { name: 'Wednesday, July 1, 2026' })).toHaveFocus();
  });
});

describe('Tooltip', () => {
  it('describes its control while it is hovered or focused, and not after', () => {
    render(
      <Tooltip text="Starts a recording now">
        <button type="button">Record</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Record' });

    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.focus(button);
    expect(button).toHaveAccessibleDescription('Starts a recording now');

    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
