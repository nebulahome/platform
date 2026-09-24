/**
 * The window picker: presets that take effect at a press, and a stretch by its two ends that is
 * refused in words when it does not make sense.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { toDateTimeLocal } from '@/lib/format-time';

import { describeChoice, readCustomRange, TimeRangePicker } from './time-range-picker';

const HOUR = 3_600_000;

describe('readCustomRange', () => {
  const now = new Date(2026, 8, 24, 12, 0).getTime();

  it('reads two ends in order, up to now', () => {
    expect(readCustomRange(toDateTimeLocal(now - 5 * HOUR), toDateTimeLocal(now), now)).toEqual({
      kind: 'custom',
      from: now - 5 * HOUR,
      to: now,
    });
  });

  it('refuses a stretch that ends before it starts, or ends in the future', () => {
    expect(readCustomRange(toDateTimeLocal(now), toDateTimeLocal(now - HOUR), now)).toMatchObject({
      problem: expect.stringContaining('before the end') as unknown,
    });
    expect(
      readCustomRange(toDateTimeLocal(now - HOUR), toDateTimeLocal(now + 2 * HOUR), now),
    ).toMatchObject({ problem: expect.stringContaining('future') as unknown });
    expect(readCustomRange('', toDateTimeLocal(now), now)).toHaveProperty('problem');
  });
});

describe('TimeRangePicker', () => {
  it('says what is shown, and takes a preset at a press', () => {
    const onChange = vi.fn();

    render(<TimeRangePicker value={{ kind: 'preset', range: '24h' }} onChange={onChange} />);

    const button = screen.getByRole('button', { name: 'Window: Last 24 hours' });

    fireEvent.click(button);
    expect(screen.getByRole('button', { name: '24h' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '7d' }));

    expect(onChange).toHaveBeenCalledWith({ kind: 'preset', range: '7d' });
    expect(screen.queryByRole('group', { name: 'Choose the window' })).toBeNull();
  });

  it('refuses a stretch the wrong way round, and shows one that reads', () => {
    const onChange = vi.fn();

    render(<TimeRangePicker value={{ kind: 'preset', range: '1h' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^Window/u }));

    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');

    fireEvent.change(from, { target: { value: '2026-09-20T10:00' } });
    fireEvent.change(to, { target: { value: '2026-09-20T09:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show this window' }));

    expect(screen.getByRole('alert').textContent).toContain('before the end');
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(to, { target: { value: '2026-09-21T09:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show this window' }));

    expect(onChange).toHaveBeenCalledWith({
      kind: 'custom',
      from: new Date('2026-09-20T10:00').getTime(),
      to: new Date('2026-09-21T09:00').getTime(),
    });
  });

  it('names a custom stretch by its two ends', () => {
    const text = describeChoice({
      kind: 'custom',
      from: new Date(2026, 8, 3, 14, 0).getTime(),
      to: new Date(2026, 8, 5, 9, 30).getTime(),
    });

    expect(text).toContain('→');
  });
});
