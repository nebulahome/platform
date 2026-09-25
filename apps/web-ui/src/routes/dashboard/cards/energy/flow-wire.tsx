/**
 * One wire of the energy card, and the power moving along it.
 *
 * A wire with nothing on it is a dim line on the house. With power on it, it takes the colour of
 * the source the power comes from - green from the panels, blue from the battery, yellow from the
 * grid - and dots of that colour run along it the way the power goes, faster the more there is.
 * For somebody who asked the system for less motion the dots stand still: the colour and the
 * figures on the card still say which way the power goes.
 */
import type { PowerSource } from '@/lib/energy-flow';

/** What a wire needs. */
export type FlowWireProps = {
  /** The wire, drawn from one end to the other. */
  readonly d: string;

  /** Where the power on it comes from; null for a wire with nothing on it. */
  readonly source: PowerSource | null;

  /** How much power is on it, in watts. */
  readonly watts: number;

  /** Which way it goes: along the wire as drawn (1), or back (-1). */
  readonly direction: 1 | -1;
};

/** The colour each source is drawn in. */
export const SOURCE_COLORS: Readonly<Record<PowerSource, string>> = {
  solar: 'var(--color-energy-solar)',
  battery: 'var(--color-energy-battery)',
  grid: 'var(--color-energy-grid)',
};

/**
 * How long the dots take to travel one period of their pattern: shorter the more power there is,
 * within bounds that keep a trickle visibly moving and a surge still readable.
 *
 * @param watts - The power on the wire.
 * @returns The duration, in seconds.
 */
export function flowSeconds(watts: number): number {
  const seconds = 2.4 - Math.log10(Math.max(watts, 1)) * 0.45;

  return Math.min(Math.max(seconds, 0.45), 2.2);
}

/**
 * Renders the wire.
 *
 * @param props - See {@link FlowWireProps}.
 * @returns The group.
 */
export function FlowWire(props: FlowWireProps) {
  const { d, source, watts, direction } = props;
  const color = source === null ? null : SOURCE_COLORS[source];

  return (
    <g aria-hidden="true" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} className="stroke-house-wire" strokeWidth={3.2} />
      {color === null ? null : (
        <>
          <path d={d} stroke={color} strokeWidth={3.2} opacity={0.5} />
          <path
            d={d}
            stroke={color}
            strokeWidth={3.6}
            strokeDasharray="2 10"
            className="animate-energy-flow motion-reduce:animate-none"
            /* eslint-disable-next-line react/forbid-dom-props -- how fast and which way are the
               power's own, known only at render. */
            style={{
              animationDuration: `${flowSeconds(watts).toFixed(2)}s`,
              animationDirection: direction === 1 ? 'normal' : 'reverse',
            }}
          />
        </>
      )}
    </g>
  );
}
