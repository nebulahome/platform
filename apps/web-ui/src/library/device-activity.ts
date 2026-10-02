/**
 * A device's activity in words: what each change was, and the lines a person reads it as.
 *
 * The API hands over what an entity reported before and after; this says it the way the rest of
 * the interface does - "Turned on", "Mode: Heat → Auto", "Went offline" - using the same words
 * the entity's reading is shown in, so a change reads here as it read on the page when it happened.
 *
 * A device dropping off the network takes every entity with it, and each reports it: six lines for
 * one event. Those are drawn as one, under the device's name, with the entities it took counted.
 */
import {
  CAPABILITIES,
  type ActivityEntry,
  type CapabilityName,
  type EntityView,
  type JsonObject,
} from '@nebulahome/contracts';

import { capabilityLabel } from '@/library/entity-kind';
import { describeState } from '@/library/entity-reading';

/** How close together availability changes must be to be one event, in milliseconds. */
const SAME_EVENT_MS = 3000;

/** One capability that changed, in words. */
export type ActivityChange = {
  readonly capability: CapabilityName;

  /** What the capability is called on this entity: "Power", "Brightness". */
  readonly label: string;

  /** What it read before; null when it had never reported. */
  readonly before: string | null;

  /** What it read after. */
  readonly after: string;
};

/** How a line is marked, by what happened. */
export type ActivityTone = 'on' | 'off' | 'change' | 'offline' | 'online';

/** One line of the activity: one change, or one device-wide event. */
export type ActivityLine = {
  /** Stable across reads: the time and the entities it covers. */
  readonly key: string;
  readonly time: Date;
  readonly kind: ActivityEntry['kind'];

  /** What the line is about: the entity, or the device when it covers several. */
  readonly title: string;

  /** What happened, in a few words. */
  readonly summary: string;
  readonly tone: ActivityTone;

  /** Every capability that changed, for the detail. */
  readonly changes: readonly ActivityChange[];

  /** The entries the line stands for: one, or every entity a device-wide event touched. */
  readonly entries: readonly ActivityEntry[];
};

/**
 * Whether a key names a capability.
 *
 * @param key - A key of a state.
 * @returns True for a capability's key.
 */
function isCapability(key: string): key is CapabilityName {
  return (CAPABILITIES as readonly string[]).includes(key);
}

/**
 * Lists what changed between two states, capability by capability.
 *
 * @param entry - The change.
 * @param entity - The entity, for the unit and class its states are written with and the label
 * of each capability; undefined when it is no longer registered.
 * @returns The capabilities whose state differs, in the order the entity reports them.
 */
export function changesOf(
  entry: Pick<ActivityEntry, 'from' | 'to'>,
  entity: Pick<EntityView, 'unitOfMeasurement' | 'deviceClass' | 'domain'> | undefined,
): ActivityChange[] {
  const from: JsonObject = entry.from ?? {};
  const keys = [...new Set([...Object.keys(entry.to), ...Object.keys(from)])].filter(isCapability);
  const words = entity ?? { unitOfMeasurement: null, deviceClass: null };

  return keys.flatMap((capability): ActivityChange[] => {
    const before = from[capability];
    const after = entry.to[capability];

    if (after === undefined || JSON.stringify(before) === JSON.stringify(after)) {
      return [];
    }

    return [
      {
        capability,
        label: capabilityLabel(capability, entity?.domain ?? ''),
        before: before === undefined ? null : describeState({ [capability]: before }, words),
        after: describeState({ [capability]: after }, words),
      },
    ];
  });
}

/**
 * Says a change of state in a few words.
 *
 * @param changes - What changed.
 * @returns "Turned on", "Clear → Detected", "Brightness: 40% → 60% and 1 more".
 */
function summaryOfChanges(changes: readonly ActivityChange[]): {
  readonly summary: string;
  readonly tone: ActivityTone;
} {
  const [first] = changes;

  if (first === undefined) {
    return { summary: 'Changed', tone: 'change' };
  }

  if (first.capability === 'on_off' && changes.length === 1) {
    return first.after === 'On'
      ? { summary: 'Turned on', tone: 'on' }
      : { summary: 'Turned off', tone: 'off' };
  }

  const bare = first.capability === 'on_off' || first.capability.startsWith('sensor_');
  const change = first.before === null ? `Now ${first.after}` : `${first.before} → ${first.after}`;
  const said = bare ? change : `${first.label}: ${change}`;
  const more = changes.length - 1;

  return {
    summary: more === 0 ? said : `${said} and ${String(more)} more`,
    tone: 'change',
  };
}

/**
 * Turns a page of entries into the lines a person reads.
 *
 * @param entries - The entries, newest first.
 * @param entities - The device's entities, by address.
 * @param deviceName - What the device is called, for a line that covers several of its entities.
 * @returns The lines, newest first.
 */
export function activityLinesOf(
  entries: readonly ActivityEntry[],
  entities: ReadonlyMap<string, EntityView>,
  deviceName: string,
): ActivityLine[] {
  const lines: ActivityLine[] = [];

  for (const entry of entries) {
    const entity = entities.get(entry.entityId);
    const name = entity?.name ?? entry.entityId;

    if (entry.kind === 'availability') {
      const previous = lines.at(-1);
      const isSameEvent =
        previous?.kind === 'availability' &&
        previous.entries[0]?.isAvailable === entry.isAvailable &&
        Math.abs(previous.time.getTime() - entry.time.getTime()) <= SAME_EVENT_MS;

      if (isSameEvent) {
        const covered = [...previous.entries, entry];

        lines[lines.length - 1] = {
          ...previous,
          key: `${previous.key}+${entry.entityId}`,
          title: deviceName,
          summary: `${entry.isAvailable ? 'Came back online' : 'Went offline'} · ${String(covered.length)} entities`,
          entries: covered,
        };
        continue;
      }

      lines.push({
        key: `${entry.time.toISOString()}:${entry.entityId}`,
        time: entry.time,
        kind: 'availability',
        title: name,
        summary: entry.isAvailable ? 'Came back online' : 'Went offline',
        tone: entry.isAvailable ? 'online' : 'offline',
        changes: [],
        entries: [entry],
      });
      continue;
    }

    const changes = changesOf(entry, entity);
    const { summary, tone } = summaryOfChanges(changes);

    lines.push({
      key: `${entry.time.toISOString()}:${entry.entityId}`,
      time: entry.time,
      kind: 'state',
      title: name,
      summary,
      tone,
      changes,
      entries: [entry],
    });
  }

  return lines;
}

/**
 * Names the day a moment falls on, for the heading of the lines under it.
 *
 * @param when - The moment.
 * @param now - Today, as the reader's clock has it.
 * @returns "Today", "Yesterday", or the date.
 */
export function dayOf(when: Date, now: Date = new Date()): string {
  /**
   * The start of a moment's day.
   *
   * @param date - The moment.
   * @returns Its midnight, in milliseconds.
   */
  const midnight = (date: Date): number =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(when)) / 86_400_000);

  if (days === 0) {
    return 'Today';
  }

  if (days === 1) {
    return 'Yesterday';
  }

  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(when.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(when);
}

/**
 * Groups lines under the day each falls on, keeping their order.
 *
 * @param lines - The lines, newest first.
 * @param now - Today, as the reader's clock has it.
 * @returns One group per day, newest first.
 */
export function byDay(
  lines: readonly ActivityLine[],
  now: Date = new Date(),
): { readonly day: string; readonly lines: readonly ActivityLine[] }[] {
  const groups: { day: string; lines: ActivityLine[] }[] = [];

  for (const line of lines) {
    const day = dayOf(line.time, now);
    const last = groups.at(-1);

    if (last?.day === day) {
      last.lines.push(line);
    } else {
      groups.push({ day, lines: [line] });
    }
  }

  return groups;
}
