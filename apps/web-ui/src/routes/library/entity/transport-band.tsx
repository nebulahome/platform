/**
 * The way each stretch of a window came in, for a reading read two ways: one band under the
 * state's, each stretch in its way's colour - the vendor's, violet for Matter - with the two ways
 * and how long the fallback carried it beside the label.
 */
import { useTranslation } from 'react-i18next';

import { MATTER_TRANSPORT } from '@nebulahome/contracts';

import { durationText } from '@/lib/format-time';
import type { TimeWindow } from '@/library/history-series';
import type { EntityWays } from '@/routes/library/entity/transport-panel';
import { TransportMark, useVendorsById } from '@/routes/library/transport-marks';
import { FALLBACK_COLOR } from '@/routes/library/vendor-card';

/** What the band needs. */
export type TransportBandProps = {
  readonly ways: EntityWays;

  /** Each stretch, by the source that carried it. */
  readonly stretches: readonly {
    readonly source: string;
    readonly from: number;
    readonly to: number;
  }[];
  readonly window: TimeWindow;

  /** How long the fallback carried it in the window. */
  readonly fallbackMs: number;
};

/**
 * Renders the band.
 *
 * @param props - See {@link TransportBandProps}.
 * @returns The band, with its label and legend.
 */
export function TransportBand(props: TransportBandProps) {
  const { t } = useTranslation();
  const { ways, stretches, window, fallbackMs } = props;
  const vendors = useVendorsById();
  const span = window.to - window.from;

  /**
   * A way's colour: the vendor's own, violet for Matter.
   *
   * @param source - The way, by its instance.
   * @returns The colour.
   */
  const colourOf = (source: string): string => {
    const way = ways.sources.find((each) => each.source.deviceId === source)?.way;

    return way === undefined || way.transport === MATTER_TRANSPORT
      ? 'var(--color-violet)'
      : (vendors.get(way.vendorId)?.color ?? FALLBACK_COLOR);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-label text-foreground-subtle uppercase">
          {t('entity.transportBand.transport', 'Transport')}
        </span>
        <span className="flex items-center gap-3 text-caption text-foreground-muted">
          {[ways.first, ways.second].map((each) => (
            <span key={each.source.deviceId} className="inline-flex items-center gap-1.5">
              <TransportMark way={each.way} vendors={vendors} size={14} />
              {each === ways.second && fallbackMs > 0
                ? t('entity.transportBand.wayFor', '{{way}} · {{for}}', {
                    way: each.name,
                    for: durationText(fallbackMs),
                  })
                : each.name}
            </span>
          ))}
        </span>
      </div>
      <div aria-hidden="true" className="relative h-2.5 overflow-hidden rounded-pill bg-control">
        {stretches.map((stretch) => (
          <span
            key={stretch.from}
            className="absolute inset-y-0 min-w-0.5"
            /* eslint-disable-next-line react/forbid-dom-props -- a stretch sits where and as long
               as it was, in its way's own colour (RULES.md 15.3). */
            style={{
              left: `${String(((Math.max(stretch.from, window.from) - window.from) / span) * 100)}%`,
              width: `${String(((Math.min(stretch.to, window.to) - Math.max(stretch.from, window.from)) / span) * 100)}%`,
              backgroundColor: colourOf(stretch.source),
            }}
          />
        ))}
      </div>
    </div>
  );
}
