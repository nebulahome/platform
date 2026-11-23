import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { parseClock, TimeField } from './time-field.js';

beforeAll(() => {
  // jsdom lays nothing out, so it has no scrolling to do.
  globalThis.Element.prototype.scrollIntoView = vi.fn();
});

describe('parseClock', () => {
  it('reads a time on either clock, with or without its colon', () => {
    expect(parseClock('20:30')).toBe('20:30');
    expect(parseClock('2030')).toBe('20:30');
    expect(parseClock('830')).toBe('08:30');
    expect(parseClock('8.30')).toBe('08:30');
    expect(parseClock('20')).toBe('20:00');
    expect(parseClock(' 8:30 pm ')).toBe('20:30');
    expect(parseClock('8pm')).toBe('20:00');
    expect(parseClock('12 am')).toBe('00:00');
    expect(parseClock('12:15 PM')).toBe('12:15');
  });

  it('refuses what is not a time', () => {
    expect(parseClock('')).toBeNull();
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('20:60')).toBeNull();
    expect(parseClock('13 pm')).toBeNull();
    expect(parseClock('soon')).toBeNull();
  });
});

describe('TimeField', () => {
  it('takes what is typed when the box is left, and puts the value back when it is not a time', () => {
    const onChange = vi.fn();

    render(<TimeField label="Starts" value="20:00" onChange={onChange} />);
    const box = screen.getByRole('textbox', { name: 'Starts' });

    fireEvent.change(box, { target: { value: '2215' } });
    fireEvent.blur(box);
    expect(onChange).toHaveBeenCalledWith('22:15');

    onChange.mockClear();
    fireEvent.change(box, { target: { value: 'later' } });
    fireEvent.blur(box);
    expect(onChange).not.toHaveBeenCalled();
    // The tests speak English, whose clock has twelve hours.
    expect((box as HTMLInputElement).value).toMatch(/^8:00\sPM$/u);
  });

  it('opens a list of quarter hours to pick from, and steps a quarter with the arrows', () => {
    const onChange = vi.fn();

    render(<TimeField label="Starts" value="20:10" onChange={onChange} />);
    const box = screen.getByRole('textbox', { name: 'Starts' });

    fireEvent.focus(box);
    fireEvent.click(screen.getByRole('button', { name: /^9:45\sPM$/u }));
    expect(onChange).toHaveBeenLastCalledWith('21:45');

    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith('20:15');

    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith('20:00');
  });
});
