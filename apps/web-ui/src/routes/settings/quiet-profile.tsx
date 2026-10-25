/**
 * A day of the house's activity, as the quietest time was learned from it: the smoothed profile from
 * midnight to midnight, and a mark where backups start.
 */
import { useTranslation } from 'react-i18next';

import { slotOfTime } from '@/routes/settings/backup-text';

/** What the chart needs. */
export type QuietProfileProps = {
  /** The activity, 96 quarter hours from midnight; null where unknown. */
  readonly profile: readonly (number | null)[];

  /** The time backups start, `HH:MM`. */
  readonly time: string;
};

/** The chart's size, in its own units. */
const WIDTH = 288;
const HEIGHT = 40;

/**
 * Renders the chart.
 *
 * @param props - See {@link QuietProfileProps}.
 * @returns The chart, or nothing without a profile.
 */
export function QuietProfile(props: QuietProfileProps) {
  const { t } = useTranslation();
  const { profile, time } = props;
  const known = profile.filter((value): value is number => value !== null);

  if (known.length === 0) {
    return null;
  }

  const top = Math.max(...known) || 1;
  const step = WIDTH / Math.max(1, profile.length - 1);
  const points = profile.map((value, index) => ({
    x: index * step,
    y: HEIGHT - 2 - ((value ?? 0) / top) * (HEIGHT - 6),
  }));
  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');
  const markX = slotOfTime(time) * step;

  return (
    <figure className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        className="h-10 w-full max-w-md"
        role="img"
        aria-label={t(
          'settings.backup.quietProfile',
          "The house's activity over a typical day; backups start at {{time}}",
          { time },
        )}
        preserveAspectRatio="none"
      >
        <path
          d={`${line} L${WIDTH.toFixed(1)} ${String(HEIGHT)} L0 ${String(HEIGHT)} Z`}
          className="fill-primary/12"
        />
        <path
          d={line}
          className="fill-none stroke-primary"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={markX}
          x2={markX}
          y1={0}
          y2={HEIGHT}
          className="stroke-foreground-muted"
          strokeWidth={1}
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="flex max-w-md justify-between text-caption text-foreground-subtle tabular">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </figcaption>
    </figure>
  );
}
