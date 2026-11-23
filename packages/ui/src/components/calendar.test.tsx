import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Calendar, dayKey, formatDay, formatDayRange, shiftDay } from './calendar.js';
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
  it('as a month of a year, hands on its name and a day pressed, the days out of the tab order', () => {
    const onMonthPress = vi.fn();
    const onDayPress = vi.fn();

    render(
      <Calendar
        size="mini"
        isReadOnly
        month="2027-03"
        value={null}
        onChange={() => undefined}
        onMonthPress={onMonthPress}
        onDayPress={onDayPress}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'March 2027' }));
    expect(onMonthPress).toHaveBeenCalledOnce();

    const day = screen.getByRole('button', { name: 'Wednesday, March 10, 2027' });

    expect(day).toHaveAttribute('tabindex', '-1');
    fireEvent.click(day);
    expect(onDayPress).toHaveBeenCalledWith('2027-03-10');
  });

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

describe('Calendar, picking a run of days', () => {
  it('keeps the first day as the start: each press moves the other end, the start lets go', () => {
    const onChange = vi.fn();

    render(
      <Calendar
        mode="range"
        value={{ from: '2026-06-18', to: '2026-06-18' }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Monday, June 22, 2026' }));
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-06-18', to: '2026-06-22' });

    fireEvent.click(screen.getByRole('button', { name: 'Monday, June 15, 2026' }));
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-06-15', to: '2026-06-18' });

    fireEvent.click(screen.getByRole('button', { name: 'Thursday, June 18, 2026' }));
    expect(onChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getByRole('button', { name: 'Wednesday, June 24, 2026' }));
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-06-24', to: '2026-06-24' });
  });

  it('draws the days between as picked, and keeps a run within maxDays of its start', () => {
    render(
      <Calendar
        mode="range"
        maxDays={3}
        value={{ from: '2026-06-10', to: '2026-06-12' }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Thursday, June 11, 2026' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Friday, June 12, 2026' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Saturday, June 13, 2026' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Monday, June 8, 2026' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Sunday, June 7, 2026' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Wednesday, June 10, 2026' }));
    expect(screen.getByRole('button', { name: 'Saturday, June 13, 2026' })).toBeEnabled();
  });

  it('writes a run once, saying what its ends share', () => {
    expect(formatDayRange({ from: '2026-06-21', to: '2026-06-25' }, 'en-GB')).toMatch(
      /^21\s?–\s?25 Jun 2026$/u,
    );
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

describe('Calendar, one month of a year', () => {
  it('shows the month it is given by name, with days that cannot be pressed and their marks', () => {
    render(
      <Calendar
        size="mini"
        isReadOnly
        month="2027-12"
        value={null}
        onChange={vi.fn()}
        renderDay={(day) =>
          day === '2027-12-08' ? { tone: 'holiday', note: 'Immaculate Conception' } : {}
        }
      />,
    );

    expect(screen.getByText('December')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTitle('Immaculate Conception')).toHaveTextContent('8');
  });
});
