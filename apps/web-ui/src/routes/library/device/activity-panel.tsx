/**
 * What changed on a device, newest first, grouped by day.
 *
 * The things a person looks for when something happened in the house: a relay switched, a door
 * opened, a thermostat changed mode, the device dropped off the network and came back. Readings
 * that change every second - power, temperature - are not here; each entity's own page draws them
 * over time. Each line says what, in a few words, and when; pressing it opens everything known
 * about that change.
 *
 * Read from the history the platform already keeps, a page at a time: the newest first, and older
 * ones when asked for, so a device with a year of switching does not arrive all at once.
 */
import { useState } from 'react';

import type { EntityView } from '@nebula-home/contracts';
import { AppIcon, Button, cn, Panel, type UiIconId } from '@nebula-home/ui';

import { toMessage } from '@/lib/error-message';
import { absoluteTime } from '@/lib/format-time';
import {
  activityLinesOf,
  byDay,
  type ActivityLine,
  type ActivityTone,
} from '@/library/device-activity';
import { ActivityDialog } from '@/routes/library/device/activity-dialog';
import { useDeviceActivity } from '@/routes/library/device/use-device-activity';

/** How each kind of line is marked: the glyph and its colour. */
const MARKS: Readonly<Record<ActivityTone, { readonly icon: UiIconId; readonly tone: string }>> = {
  on: { icon: 'power', tone: 'text-success border-success/30 bg-success/10' },
  off: { icon: 'power', tone: 'text-foreground-subtle border-border-soft face-raised' },
  change: { icon: 'activity', tone: 'text-primary border-primary/30 bg-primary/10' },
  offline: { icon: 'triangle-alert', tone: 'text-warning border-warning/30 bg-warning/10' },
  online: { icon: 'check', tone: 'text-success border-success/30 bg-success/10' },
};

/** The time of day a line happened at. */
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** What the panel needs. */
export type ActivityPanelProps = {
  /** The device, by its id. */
  readonly deviceId: string;

  /** What the device is called, for a line that covers several of its entities. */
  readonly deviceName: string;

  /** The device's entities. */
  readonly entities: readonly EntityView[];
};

/**
 * Renders the panel, or nothing for somebody who may not read the past.
 *
 * @param props - See {@link ActivityPanelProps}.
 * @returns The panel.
 */
export function ActivityPanel(props: ActivityPanelProps) {
  const { deviceId, deviceName, entities } = props;
  const byAddress = new Map(entities.map((entity) => [entity.entityId, entity]));
  const activity = useDeviceActivity(
    deviceId,
    entities.map((entity) => entity.entityId),
  );
  const [opened, setOpened] = useState<ActivityLine | null>(null);

  if (!activity.canRead) {
    return null;
  }

  const lines =
    activity.entries === undefined
      ? undefined
      : activityLinesOf(activity.entries, byAddress, deviceName);

  return (
    // Clipped to its corners: the list scrolls inside, and its scrollbar must not cross them.
    <Panel title="Activity" className="overflow-hidden">
      {activity.error !== null && lines === undefined ? (
        <p role="alert" className="px-4 py-3.5 text-ui text-danger">
          {toMessage(activity.error)}
        </p>
      ) : lines === undefined ? (
        <p className="px-4 py-3.5 text-ui text-foreground-muted">Reading…</p>
      ) : lines.length === 0 ? (
        <p className="px-4 py-3.5 text-ui text-foreground-muted">
          Nothing has changed yet. Switches, doors, modes and the device going offline show here as
          they happen; readings are drawn on each entity&apos;s own page.
        </p>
      ) : (
        // About eight changes tall, then it scrolls: a busy device must not push everything
        // under it off the page.
        <div className="flex max-h-[30rem] flex-col overflow-y-auto pb-1.5">
          {byDay(lines).map((group) => (
            <section key={group.day} aria-label={group.day}>
              <h3 className="px-4 pt-3 pb-1 text-label text-foreground-subtle uppercase">
                {group.day}
              </h3>
              <ol className="flex flex-col px-1.5">
                {group.lines.map((line) => {
                  const mark = MARKS[line.tone];

                  return (
                    <li key={line.key}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpened(line);
                        }}
                        className="press grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-field px-2.5 py-2 text-left transition-colors hover:bg-surface-raised/60 focus-visible:ring-3 focus-visible:ring-primary/25 focus-visible:outline-none"
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'flex size-7 items-center justify-center rounded-full border',
                            mark.tone,
                          )}
                        >
                          <AppIcon id={mark.icon} size={13} />
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-ui font-medium text-foreground">
                            {line.title}
                          </span>
                          <span className="truncate text-caption text-foreground-muted">
                            {line.summary}
                          </span>
                        </span>
                        <time
                          dateTime={line.time.toISOString()}
                          title={absoluteTime(line.time)}
                          className="text-caption whitespace-nowrap text-foreground-subtle tabular"
                        >
                          {clock.format(line.time)}
                        </time>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}

          {activity.hasMore ? (
            <div className="flex justify-center px-4 pt-2 pb-2">
              <Button
                variant="ghost"
                size="compact"
                isBusy={activity.isLoadingMore}
                onClick={activity.loadMore}
              >
                Show earlier
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <ActivityDialog
        line={opened}
        entities={byAddress}
        onClose={() => {
          setOpened(null);
        }}
      />
    </Panel>
  );
}
