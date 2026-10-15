/**
 * Where the home is, drawn small on the Home step of the first run (board N-Setup-2).
 *
 * No map tiles: the first run happens before anything is configured, often before the hub can
 * reach the internet, and a position is all the house needs - for sunrise and sunset, the weather
 * and the solar forecast. So a grid with a pin, the sun's path across it, the coordinates, and
 * today's sunrise and sunset worked out on the spot: a wrong sign on the longitude shows at once
 * as a sunrise at teatime.
 */
import { useTranslation } from 'react-i18next';

import { sunTimes } from '@nebulahome/contracts';
import { AppIcon } from '@nebulahome/ui';

import { dateTimeFormat } from '@/i18n/formatters';
import type { HousePosition } from '@/lib/house-position';

/** What the preview needs. */
export type HomeLocationPreviewProps = {
  /** Where the home is, or null while nothing readable is typed. */
  readonly position: HousePosition | null;

  /** The home's zone, for the times. */
  readonly timeZone: string;

  /** The day the times are for; today unless said. */
  readonly day?: Date;
};

/**
 * A coordinate as a compass reads it: `45.46° N`.
 *
 * @param value - The coordinate.
 * @param positive - Its letter north or east.
 * @param negative - Its letter south or west.
 * @returns The words.
 */
function compass(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(2)}° ${value < 0 ? negative : positive}`;
}

/**
 * A moment on the home's clock: `07:14`.
 *
 * @param moment - The moment, or null when it does not happen today.
 * @param timeZone - The home's zone.
 * @returns The time, or a dash.
 */
function clock(moment: Date | null, timeZone: string): string {
  if (moment === null) {
    return '—';
  }

  try {
    return dateTimeFormat({
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(moment);
  } catch {
    return '—';
  }
}

/**
 * Renders the preview.
 *
 * @param props - See {@link HomeLocationPreviewProps}.
 * @returns The preview.
 */
export function HomeLocationPreview(props: HomeLocationPreviewProps) {
  const { t } = useTranslation();
  const { position, timeZone, day = new Date() } = props;
  const times = position === null ? null : sunTimes(day, position);

  return (
    <div className="relative h-38 overflow-hidden rounded-inner border border-border bg-surface">
      <svg
        aria-hidden="true"
        className="absolute inset-0 size-full text-border"
        preserveAspectRatio="none"
        viewBox="0 0 600 150"
      >
        <defs>
          <pattern id="home-grid" width="57" height="38" patternUnits="userSpaceOnUse">
            <path d="M 57 0 L 0 0 0 38" fill="none" stroke="currentColor" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="600" height="150" fill="url(#home-grid)" />
        {/* The sun's path across the day, low and faint: it is there to be read, not looked at. */}
        <path
          d="M 0 140 Q 300 10 600 140"
          fill="none"
          className="text-primary"
          stroke="currentColor"
          strokeOpacity="0.28"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </svg>

      {position === null ? (
        <p className="absolute inset-0 flex items-center justify-center text-ui-sm text-foreground-subtle">
          {t('home.noPosition', 'No position yet')}
        </p>
      ) : (
        <>
          <span className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-3/4 flex-col items-center">
            <AppIcon id="map-pin" size={26} className="text-primary" />
            <span className="mt-0.5 h-1.5 w-7 rounded-full bg-primary/25" />
          </span>
          <span className="absolute bottom-2.5 left-3 font-mono text-mono-caption text-foreground-muted">
            {`${compass(position.latitude, t('home.north', 'N'), t('home.south', 'S'))} · ${compass(
              position.longitude,
              t('home.east', 'E'),
              t('home.west', 'W'),
            )}`}
          </span>
          <span className="absolute right-3 bottom-2.5 flex items-center gap-3 font-mono text-mono-caption text-foreground-muted">
            <span className="flex items-center gap-1.5" title={t('home.sunrise', 'Sunrise today')}>
              <AppIcon id="sunrise" size={13} className="text-warning" />
              {clock(times?.sunrise ?? null, timeZone)}
            </span>
            <span className="flex items-center gap-1.5" title={t('home.sunset', 'Sunset today')}>
              <AppIcon id="sunset" size={13} className="text-warning" />
              {clock(times?.sunset ?? null, timeZone)}
            </span>
          </span>
        </>
      )}
    </div>
  );
}
