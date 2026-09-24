/**
 * What an entity reads, in the few characters a row has for it.
 *
 * A reading is words and figures - "On · 60%", "215 °C" - and where a figure has a shape the
 * summary draws it too: a lamp's brightness as a short bar, its colour or its white as a dot.
 * The words stay: the bar and the dot are there to be seen at a glance down a list, and the
 * words are what is read (RULES.md 15.5).
 *
 * An entity the adapter cannot reach says so rather than showing its last value as though it
 * were current.
 */
import type { CapabilityState } from '@nebula-home/contracts';
import { cn } from '@nebula-home/ui';

import { hsColor, kelvinColor, miredsToKelvin } from '@/library/entity-control';
import type { Reading } from '@/library/entity-reading';

/** What the summary needs. */
export type EntityStateSummaryProps = {
  /** The reading, in words. */
  readonly reading: Reading;

  /** The state it was read from, for the bar and the dot. */
  readonly state: CapabilityState;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * The colour a lamp is showing, when it shows one.
 *
 * @param state - Its state.
 * @returns A CSS colour for the dot, or null for a lamp that is off or has no colour.
 */
function lampColour(state: CapabilityState): string | null {
  if (state.on_off?.isOn === false) {
    return null;
  }

  if (state.color_hs !== undefined) {
    return hsColor(state.color_hs.hue, state.color_hs.saturation);
  }

  if (state.color_temp !== undefined) {
    return kelvinColor(miredsToKelvin(state.color_temp.mireds));
  }

  return null;
}

/**
 * Renders the summary.
 *
 * @param props - See {@link EntityStateSummaryProps}.
 * @returns The summary.
 */
export function EntityStateSummary(props: EntityStateSummaryProps) {
  const { reading, state, className } = props;
  const title = reading.at === null ? 'Never reported' : `Reported ${reading.at.toLocaleString()}`;

  if (!reading.isAvailable) {
    return (
      <span
        className={cn('text-caption whitespace-nowrap text-foreground-subtle', className)}
        title={title}
      >
        Unavailable
      </span>
    );
  }

  const figure = reading.sensorFigure;

  if (figure !== null) {
    return (
      <span
        className={cn('inline-flex items-baseline gap-1 whitespace-nowrap', className)}
        title={title}
        data-live={reading.isLive ? 'true' : undefined}
      >
        <span className="font-mono text-ui text-foreground tabular">{figure.figure}</span>
        {figure.unit !== null && figure.unit !== '' ? (
          <span className="text-caption text-foreground-subtle">{figure.unit}</span>
        ) : null}
      </span>
    );
  }

  const colour = lampColour(state);
  const level = state.on_off?.isOn === false ? undefined : state.level?.level;

  return (
    <span
      className={cn('inline-flex items-center gap-2 whitespace-nowrap', className)}
      title={title}
      data-live={reading.isLive ? 'true' : undefined}
    >
      {level === undefined ? null : (
        <span
          aria-hidden="true"
          className="hidden h-1.5 w-10 overflow-hidden rounded-full bg-control sm:block"
        >
          <span
            className="block h-full rounded-full bg-lamp"
            /* eslint-disable-next-line react/forbid-dom-props -- the bar is as long as the level,
               a number no class can carry (RULES.md 15.3). */
            style={{ width: `${String(level)}%` }}
          />
        </span>
      )}
      {colour === null ? null : (
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full ring-1 ring-border-strong"
          /* eslint-disable-next-line react/forbid-dom-props -- the dot is the lamp's own colour,
             which the palette does not hold (RULES.md 15.3). */
          style={{ backgroundColor: colour }}
        />
      )}
      <span className="font-mono text-ui text-foreground tabular">{reading.text}</span>
    </span>
  );
}
