import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Slider, sliderPercent } from './slider.js';
import { Stepper, stepValue } from './stepper.js';
import { Switch } from './switch.js';

describe('Slider', () => {
  it('follows the knob on input and commits once the browser says the move ended', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();

    render(
      <Slider
        label="Brightness"
        value={40}
        min={0}
        max={100}
        display="40%"
        onChange={onChange}
        onCommit={onCommit}
      />,
    );
    const input = screen.getByRole('slider', { name: 'Brightness' });

    fireEvent.input(input, { target: { value: '55' } });
    expect(onChange).toHaveBeenCalledWith(55);
    expect(onCommit).not.toHaveBeenCalled();

    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('tells a reader the value in words', () => {
    render(
      <Slider
        label="Warmth"
        value={3000}
        min={2000}
        max={6500}
        display="3000 K"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('slider', { name: 'Warmth' })).toHaveAttribute(
      'aria-valuetext',
      '3000 K',
    );
  });

  it('places a value along its range, and survives a range with no width', () => {
    expect(sliderPercent(25, 0, 50)).toBe(50);
    expect(sliderPercent(120, 0, 100)).toBe(100);
    expect(sliderPercent(5, 5, 5)).toBe(0);
  });
});

describe('Switch', () => {
  it('is announced as a switch and asks for the other state', () => {
    const onChange = vi.fn();

    render(<Switch label="Kitchen ceiling" isOn={false} onChange={onChange} />);
    const control = screen.getByRole('switch', { name: 'Kitchen ceiling' });

    expect(control).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('cannot be pressed while its last change is on its way', () => {
    const onChange = vi.fn();

    render(<Switch label="Relay" isOn onChange={onChange} isBusy />);
    fireEvent.click(screen.getByRole('switch', { name: 'Relay' }));

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Stepper', () => {
  it('steps on its grid without the float drifting', () => {
    const bounds = { min: 5, max: 30, step: 0.1 };

    expect(stepValue(21.2, 1, bounds)).toBe(21.3);
    expect(stepValue(21.3, -1, bounds)).toBe(21.2);
  });

  it('stops at the ends of its range', () => {
    const bounds = { min: 7, max: 30, step: 0.5 };

    expect(stepValue(30, 1, bounds)).toBe(30);
    expect(stepValue(7, -1, bounds)).toBe(7);
  });

  it('moves from its buttons and from the arrow keys, and refuses past the end', () => {
    const onChange = vi.fn();

    render(
      <Stepper
        label="Target"
        value={30}
        min={7}
        max={30}
        step={0.5}
        format={(value) => `${String(value)} °C`}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('button', { name: 'Raise Target' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Lower Target' }));
    expect(onChange).toHaveBeenLastCalledWith(29.5);

    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Target' }), { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(7);
  });
});
