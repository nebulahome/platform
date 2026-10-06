/**
 * A colour as a point on a wheel: the hue around it, the saturation out from its white middle.
 *
 * The shape a person already knows from every lighting app, and the one where a colour is found
 * by looking rather than by reading two numbers. The knob is painted the colour it points at.
 *
 * **Two callbacks, as a slider has.** `onChange` follows the knob, so whatever shows the colour
 * keeps up with the finger; `onCommit` fires when the knob is let go, and once per key step, and
 * is what commands a lamp - a command per pixel of travel would queue a hundred fades.
 *
 * **The keyboard moves it too**, since a wheel a keyboard cannot reach is a control half the
 * house cannot use: left and right turn the hue, up and down the saturation, one step at a time,
 * ten with Shift. It is one slider to a screen reader, its value spoken as both.
 *
 * The gradients are the one place a component paints with inline style: they are computed from
 * nothing the palette holds, which is what RULES.md 15.3 allows a colour picker.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { cn } from '../lib/cn.js';

/** A colour as the wheel holds it. */
export type WheelColour = {
  /** 0 to 360, 0 being red at the right, going clockwise. */
  readonly hue: number;

  /** 0 to 100, from the white middle to the rim. */
  readonly saturation: number;
};

/** What a wheel needs. */
export type ColorWheelProps = {
  /** What it sets, for a screen reader. */
  readonly label: string;

  /** Where the knob stands. */
  readonly value: WheelColour;

  /** Called as the knob moves. */
  readonly onChange: (value: WheelColour) => void;

  /** Called once the knob is let go, and on each step a key takes. */
  readonly onCommit: (value: WheelColour) => void;

  /** Its width and height, in pixels. */
  readonly size?: number;

  /** Whether it can be moved at all. */
  readonly disabled?: boolean;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * The CSS colour of a hue and a saturation at full brightness, as the wheel paints its knob.
 *
 * @param colour - The colour.
 * @returns A CSS colour.
 */
export function wheelColour(colour: WheelColour): string {
  const lightness = 100 - colour.saturation / 2;

  return `hsl(${String(Math.round(colour.hue))} ${String(Math.round(colour.saturation))}% ${String(Math.round(lightness))}%)`;
}

/**
 * Reads the colour under a point of the wheel.
 *
 * @param x - Across, from the wheel's middle, in pixels.
 * @param y - Down, from the wheel's middle, in pixels.
 * @param radius - The wheel's radius, in pixels.
 * @returns The colour; a point outside the rim reads as on it.
 */
export function colourAt(x: number, y: number, radius: number): WheelColour {
  const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const saturation = Math.min(100, (Math.hypot(x, y) / radius) * 100);

  return { hue: Math.round(hue), saturation: Math.round(saturation) };
}

/** The rim of hues, clockwise from red at the right. */
const HUES = `conic-gradient(from 90deg, ${[0, 60, 120, 180, 240, 300, 360]
  .map((hue) => `hsl(${String(hue)} 100% 50%)`)
  .join(', ')})`;

/** The white middle, fading out towards the rim. */
const WHITE_MIDDLE = 'radial-gradient(circle closest-side, #fff 0%, rgb(255 255 255 / 0) 100%)';

/**
 * Renders the wheel.
 *
 * @param props - See {@link ColorWheelProps}.
 * @returns The wheel.
 */
export function ColorWheel(props: ColorWheelProps) {
  const { label, value, onChange, onCommit, size = 208, disabled = false, className } = props;
  const wheelRef = useRef<HTMLDivElement>(null);
  const [isDragging, setDragging] = useState(false);
  const radius = size / 2;
  const angle = (value.hue * Math.PI) / 180;
  const reach = (value.saturation / 100) * radius;
  const knob = { x: radius + Math.cos(angle) * reach, y: radius + Math.sin(angle) * reach };

  /**
   * Reads the colour under the pointer.
   *
   * @param event - The pointer event.
   * @returns The colour, or undefined before the wheel is on the page.
   */
  const colourOf = (event: PointerEvent<HTMLDivElement>): WheelColour | undefined => {
    const box = wheelRef.current?.getBoundingClientRect();

    if (box === undefined) {
      return undefined;
    }

    return colourAt(
      event.clientX - box.left - box.width / 2,
      event.clientY - box.top - box.height / 2,
      box.width / 2,
    );
  };

  /**
   * Moves the knob by a step from the keyboard.
   *
   * @param event - The key.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 10 : 1;
    const moves: Readonly<Record<string, WheelColour>> = {
      ArrowRight: { hue: (value.hue + step) % 360, saturation: value.saturation },
      ArrowLeft: { hue: (value.hue - step + 360) % 360, saturation: value.saturation },
      ArrowUp: { hue: value.hue, saturation: Math.min(100, value.saturation + step) },
      ArrowDown: { hue: value.hue, saturation: Math.max(0, value.saturation - step) },
    };
    const next = moves[event.key];

    if (next === undefined || disabled) {
      return;
    }

    event.preventDefault();
    onChange(next);
    onCommit(next);
  };

  return (
    <div
      ref={wheelRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled}
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(value.hue)}
      aria-valuetext={`Hue ${String(Math.round(value.hue))}°, saturation ${String(Math.round(value.saturation))}%`}
      className={cn(
        'relative shrink-0 touch-none rounded-full ring-1 ring-border-strong select-none',
        'focus-visible:ring-3 focus-visible:ring-primary/40 focus-visible:outline-none',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-crosshair',
        className,
      )}
      /* eslint-disable-next-line react/forbid-dom-props -- the wheel's size and its gradients
         are computed, not tokens (RULES.md 15.3). */
      style={{ width: size, height: size, backgroundImage: `${WHITE_MIDDLE}, ${HUES}` }}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (disabled) {
          return;
        }

        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);

        const next = colourOf(event);

        if (next !== undefined) {
          onChange(next);
        }
      }}
      onPointerMove={(event) => {
        const next = isDragging ? colourOf(event) : undefined;

        if (next !== undefined) {
          onChange(next);
        }
      }}
      onPointerUp={(event) => {
        if (!isDragging) {
          return;
        }

        setDragging(false);

        const next = colourOf(event);

        if (next !== undefined) {
          onCommit(next);
        }
      }}
      onPointerCancel={() => {
        setDragging(false);
      }}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full',
          'border-2 border-surface ring-1 ring-border-strong',
          isDragging ? 'scale-110' : 'transition-[left,top] duration-150',
        )}
        /* eslint-disable-next-line react/forbid-dom-props -- where the knob is, and the colour it
           points at, are live values (RULES.md 15.3). */
        style={{ left: knob.x, top: knob.y, backgroundColor: wheelColour(value) }}
      />
    </div>
  );
}
