/**
 * When something was on, across a window: a band, filled where it was on, open or detected.
 *
 * The question a switch's past answers is "when, and for how long", and a band answers both at a
 * glance where a list of changes makes the reader do the sums. The sum is also said in words
 * under it - "On for 3 h 20 min" - which is the band's reading for anyone who cannot see it.
 * A stretch the device could not be reached is greyed out rather than drawn as off, and its
 * tooltip says so.
 */
import { useTranslation } from 'react-i18next';

import { cn } from '@nebulahome/ui';

import { durationText } from '@/lib/format-time';
import type { StateSegment, TimeWindow } from '@/library/history-series';

/** What the band needs. */
export type StateBandProps = {
  /** The stretches, left to right. */
  readonly segments: readonly StateSegment[];

  /** The window they fill. */
  readonly window: TimeWindow;

  /** What the active state is called: "On", "Open", "Detected". */
  readonly activeWord: string;
};

/**
 * Renders the band.
 *
 * @param props - See {@link StateBandProps}.
 * @returns The band, with its total in words.
 */
export function StateBand(props: StateBandProps) {
  const { t } = useTranslation();

  const { segments, window, activeWord } = props;
  const span = window.to - window.from;
  const activeMs = segments
    .filter((segment) => segment.isActive && segment.isAvailable)
    .reduce((sum, segment) => sum + (segment.to - segment.from), 0);

  return (
    <div className="flex flex-col gap-2">
      <div aria-hidden="true" className="flex h-6 overflow-hidden rounded-chip bg-control">
        {segments.map((segment) => (
          <span
            key={segment.from}
            title={t('entity.stateBand.labelDurationtext', '{{label}}, {{durationText}}', {
              label: segment.label,
              durationText: durationText(segment.to - segment.from),
            })}
            className={cn(
              'h-full',
              !segment.isAvailable
                ? 'bg-foreground-disabled/45'
                : segment.isActive
                  ? 'bg-primary'
                  : 'bg-transparent',
            )}
            /* eslint-disable-next-line react/forbid-dom-props -- a stretch is as wide as it
               lasted, which no class can carry (RULES.md 15.3). */
            style={{ width: `${String(((segment.to - segment.from) / span) * 100)}%` }}
          />
        ))}
      </div>
      <p className="text-caption text-foreground-muted">
        {activeMs === 0
          ? t('entity.stateBand.notInThisWindow', 'Not {{word}} in this window.', {
              word: activeWord.toLowerCase(),
            })
          : t(
              'entity.stateBand.activewordForActivemsIn',
              '{{activeWord}} for {{activeMs}} in this window.',
              { activeWord, activeMs: durationText(activeMs) },
            )}
      </p>
    </div>
  );
}
