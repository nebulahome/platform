/**
 * The volume the platform's data lives on, cut into who is using it.
 *
 * One bar, end to end: the platform itself, each installed package, the backups, everything else
 * on the disk, and what is free. Beside it the same slices in words, and under the platform's own
 * slice what it is made of - the database, the map tiles - because "NebulaHome takes 2 GB" only
 * becomes something a person can act on once they can see which part of it grew.
 *
 * The totals are read every few seconds; the slices are counted every five minutes, because
 * counting means walking directories, and the card says when they were last counted.
 */
import type { DiskUsage } from '@nebula-home/contracts';
import { cn, Panel, PanelNote } from '@nebula-home/ui';

import { formatBytes, formatPercent, formatShare } from '@/lib/format-bytes';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import {
  diskPercent,
  diskSegments,
  isPartlyElsewhere,
  partLabel,
  type DiskSegment,
} from '@/system/system-readings';

/**
 * Writes the time of day a count finished.
 *
 * A clock time rather than "two minutes ago": the relative phrase comes out in the browser's
 * language, and in the middle of an English sentence it reads as two languages at once.
 *
 * @param when - The moment.
 * @returns Hours and minutes.
 */
function clockTime(when: Date): string {
  return new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(when);
}

/** The fills packages take in turn, so two packages side by side never share a colour. */
const PACKAGE_FILLS = ['bg-tag-blue', 'bg-tag-amber', 'bg-tag-pink', 'bg-tag-lime'] as const;

/**
 * The fill a slice is drawn in.
 *
 * @param segment - The slice.
 * @param packageIndex - Its place among the packages, for a package.
 * @returns A background class from the tokens.
 */
function fillOf(segment: DiskSegment, packageIndex: number): string {
  switch (segment.kind) {
    case 'core': {
      return 'bg-primary';
    }
    case 'package': {
      return PACKAGE_FILLS[packageIndex % PACKAGE_FILLS.length] ?? 'bg-tag-blue';
    }
    case 'backups': {
      return 'bg-tag-orange';
    }
    case 'other': {
      return 'bg-foreground-subtle/45';
    }
    case 'free': {
      return 'bg-groove';
    }
  }
}

/** What the card needs. */
export type SystemDiskCardProps = {
  /** The volume, or null when it could not be read. */
  readonly disk: DiskUsage | null;
};

/**
 * Renders the card.
 *
 * @param props - See {@link SystemDiskCardProps}.
 * @returns The card.
 */
export function SystemDiskCard(props: SystemDiskCardProps) {
  const { disk } = props;
  const isReduced = useReducedMotion();

  if (disk === null) {
    return (
      <Panel title="Disk">
        <PanelNote>The volume the data lives on could not be read.</PanelNote>
      </Panel>
    );
  }

  const segments = diskSegments(disk);
  const packages = segments.filter((segment) => segment.kind === 'package');
  const fills = new Map(
    segments.map((segment) => [segment.id, fillOf(segment, packages.indexOf(segment))]),
  );
  const core = disk.categories.find((category) => category.kind === 'core');

  return (
    <Panel
      title="Disk"
      action={
        <span className="text-caption text-foreground-subtle tabular">
          {formatBytes(disk.usedBytes)} of {formatBytes(disk.usedBytes + disk.freeBytes)} used
        </span>
      }
    >
      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="flex items-baseline gap-3">
          <span className="text-reading font-semibold tracking-tight tabular">
            {formatPercent(diskPercent(disk))}
          </span>
          <span className="text-caption text-foreground-subtle">
            {formatBytes(disk.freeBytes)} free
          </span>
        </div>

        <div
          aria-hidden
          className="flex h-3 w-full gap-px overflow-hidden rounded-full border border-border-soft bg-groove"
        >
          {segments.map((segment) => (
            <span
              key={segment.id}
              className={cn(
                'h-full first:rounded-l-full last:rounded-r-full',
                fills.get(segment.id),
                isReduced ? undefined : 'transition-[width] duration-700 ease-out',
              )}
              /* eslint-disable-next-line react/forbid-dom-props -- a slice's width is its share
                 of the disk, read from the answer: the one value on the card no class can hold. */
              style={{ width: `${String(segment.share * 100)}%` }}
            />
          ))}
        </div>

        <ul className="flex flex-col divide-y divide-border-soft">
          {segments.map((segment) => (
            <li key={segment.id} className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
              <span className="flex items-center gap-2.5 text-ui">
                <span aria-hidden className={cn('size-2.5 rounded-full', fills.get(segment.id))} />
                <span className="grow text-foreground">{segment.label}</span>
                <span className="text-foreground-muted tabular">{formatBytes(segment.bytes)}</span>
                <span className="w-11 text-right text-caption text-foreground-subtle tabular">
                  {formatShare(segment.share)}
                </span>
              </span>

              {segment.kind === 'core' && core !== undefined && core.parts.length > 0 ? (
                <ul className="flex flex-col gap-1 pl-5">
                  {core.parts.map((part) => (
                    <li
                      key={part.id}
                      className="flex items-center gap-2.5 text-caption text-foreground-subtle"
                    >
                      <span className="grow">{partLabel(part.id)}</span>
                      <span className="tabular">{formatBytes(part.bytes)}</span>
                      {/* Under the share column, so the sizes line up with the one above. */}
                      <span aria-hidden className="w-11" />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <PanelNote>
        {disk.measuredAt === null
          ? 'Counting what is on the disk…'
          : `Counted at ${clockTime(disk.measuredAt)}, and again every five minutes.`}
        {isPartlyElsewhere(disk)
          ? ' Part of what NebulaHome keeps is on another disk - the database, when it runs in Docker - so the bar is a little longer than this volume.'
          : ''}
      </PanelNote>
    </Panel>
  );
}
