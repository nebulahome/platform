/**
 * A ring that fills to a share, with the share written inside it.
 *
 * For a reading that has a ceiling - the processor, the memory - where "how full" is the whole
 * question and a ring answers it before the number is read. Recharts draws it, in token colours,
 * and eases it to each new reading unless the person asked for less motion. The number in the
 * middle is text, so the ring itself is hidden from assistive technology.
 */
import { PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts';

import { formatPercent } from '@/lib/format-bytes';
import { useReducedMotion } from '@/lib/use-reduced-motion';

/** What the ring needs. */
export type UsageRingProps = {
  /** The share, 0 to 100, or null for none. */
  readonly percent: number | null;

  /** A colour token: `var(--color-primary)`. */
  readonly color: string;
};

/** The ring's size, in pixels: a fixed size, so it needs nothing measured before it draws. */
const SIZE = 88;

/**
 * Renders the ring.
 *
 * @param props - See {@link UsageRingProps}.
 * @returns The ring.
 */
export function UsageRing(props: UsageRingProps) {
  const { percent, color } = props;
  const isReduced = useReducedMotion();

  return (
    <div className="relative size-22 shrink-0">
      <div aria-hidden className="absolute inset-0">
        <RadialBarChart
          width={SIZE}
          height={SIZE}
          data={[{ value: percent ?? 0 }]}
          innerRadius="80%"
          outerRadius="100%"
          startAngle={90}
          endAngle={-270}
          barSize={8}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
          <RadialBar
            dataKey="value"
            fill={color}
            cornerRadius={8}
            background={{ fill: 'var(--color-groove)' }}
            isAnimationActive={!isReduced}
            animationDuration={700}
            animationEasing="ease-out"
          />
        </RadialBarChart>
      </div>

      <span className="absolute inset-0 flex items-center justify-center text-title font-semibold tabular">
        {formatPercent(percent)}
      </span>
    </div>
  );
}
