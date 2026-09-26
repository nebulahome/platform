/**
 * The colour wheel: where a point on it is, and a keyboard that moves it as well as a finger.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ColorWheel, colourAt, wheelColour } from './color-wheel.js';

describe('colourAt', () => {
  it('reads the hue around the wheel, red at the right and clockwise, and saturation outwards', () => {
    expect(colourAt(100, 0, 100)).toEqual({ hue: 0, saturation: 100 });
    expect(colourAt(0, 50, 100)).toEqual({ hue: 90, saturation: 50 });
    expect(colourAt(-100, 0, 100)).toEqual({ hue: 180, saturation: 100 });
    expect(colourAt(0, -100, 100)).toEqual({ hue: 270, saturation: 100 });
    expect(colourAt(0, 0, 100)).toEqual({ hue: 0, saturation: 0 });
  });

  it('reads a point past the rim as on it', () => {
    expect(colourAt(300, 0, 100).saturation).toBe(100);
  });
});

describe('ColorWheel', () => {
  it('turns the hue with the arrows left and right, and the saturation with up and down', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();

    render(
      <ColorWheel
        label="Colour"
        value={{ hue: 355, saturation: 50 }}
        onChange={onChange}
        onCommit={onCommit}
      />,
    );

    const wheel = screen.getByRole('slider', { name: 'Colour' });

    expect(wheel.getAttribute('aria-valuetext')).toBe('Hue 355°, saturation 50%');

    fireEvent.keyDown(wheel, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(wheel, { key: 'ArrowUp' });

    expect(onCommit).toHaveBeenNthCalledWith(1, { hue: 5, saturation: 50 });
    expect(onCommit).toHaveBeenNthCalledWith(2, { hue: 355, saturation: 51 });
  });

  it('moves nothing when it is disabled', () => {
    const onCommit = vi.fn();

    render(
      <ColorWheel
        label="Colour"
        value={{ hue: 10, saturation: 50 }}
        onChange={vi.fn()}
        onCommit={onCommit}
        disabled
      />,
    );

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Colour' }), { key: 'ArrowLeft' });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('paints a colour the way a bulb fades to white', () => {
    expect(wheelColour({ hue: 120, saturation: 100 })).toBe('hsl(120 100% 50%)');
    expect(wheelColour({ hue: 120, saturation: 0 })).toBe('hsl(120 0% 100%)');
  });
});
