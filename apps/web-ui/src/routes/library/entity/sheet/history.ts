/**
 * What the History drawer of the entity dialog draws, worked out from the history endpoints'
 * points.
 *
 * The canvas draws two drawers open: a lamp that only switches, as a band of when it was on, and
 * a dimmable one, as a stepped line of its brightness. Every other kind of thing reuses those two:
 * the band for what reads as on or off (open, unlocked, playing, cleaning, home), the stepped line
 * for its main number (a cover's position, a fan's speed, a thermostat's target), and under
 * either the three figures the canvas puts there.
 */
import type { CapabilityState, EntityView, StateHistoryPoint } from '@nebulahome/contracts';

import { dateTimeFormat } from '@/i18n/formatters';
import { translate } from '@/i18n/messages';
import { hasCapability, paramsOf } from '@/library/entity-control';
import {
  numericSeries,
  stateSegments,
  type NumericField,
  type StateSegment,
  type TimeWindow,
} from '@/library/history-series';
import { activeStats, durationText } from '@/library/history-stats';
import type { StatTile } from '@/routes/library/entity/sheet/parts/sheet-parts';
import type { SheetRange } from '@/routes/library/entity/sheet/sheet-types';

/** A point of a line: when, and the value then. */
export type LinePoint = { readonly at: number; readonly value: number };

/** What a drawer draws. */
export type DrawerContent =
  | {
      /** A band of when the thing was on, open or detected. */
      readonly kind: 'band';
      readonly segments: readonly StateSegment[];
      readonly stats: readonly StatTile[];
    }
  | {
      /** A stepped line of its main number. */
      readonly kind: 'step';
      readonly points: readonly LinePoint[];
      readonly domain: readonly [number, number];
      readonly stats: readonly StatTile[];
      readonly label: string;
    };

/** The words of a band's figures: how long it was on, how often it turned on, when last. */
type ActiveWords = {
  readonly activeFor: string;
  readonly turnedOn: string;
  readonly last: string;
};

/**
 * Says the active state's words for an entity's band.
 *
 * @param entity - The entity.
 * @returns "On for · Turned on · Last on", or the kind's own.
 */
function activeWordsOf(entity: Pick<EntityView, 'capabilities' | 'deviceClass'>): ActiveWords {
  const opens = ['door', 'window', 'opening', 'garage_door'];

  if (
    hasCapability(entity, 'cover') ||
    (hasCapability(entity, 'sensor_binary') && opens.includes(entity.deviceClass ?? ''))
  ) {
    return {
      activeFor: translate('entity.sheet.history.openFor', 'Open for'),
      turnedOn: translate('entity.sheet.history.opened', 'Opened'),
      last: translate('entity.sheet.history.lastOpened', 'Last opened'),
    };
  }

  if (hasCapability(entity, 'lock')) {
    return {
      activeFor: translate('entity.sheet.history.unlockedFor', 'Unlocked for'),
      turnedOn: translate('entity.sheet.history.unlocked', 'Unlocked'),
      last: translate('entity.sheet.history.lastUnlocked', 'Last unlocked'),
    };
  }

  if (hasCapability(entity, 'media_player')) {
    return {
      activeFor: translate('entity.sheet.history.playingFor', 'Playing for'),
      turnedOn: translate('entity.sheet.history.started', 'Started'),
      last: translate('entity.sheet.history.lastPlayed', 'Last played'),
    };
  }

  if (hasCapability(entity, 'vacuum') || hasCapability(entity, 'lawn_mower')) {
    return {
      activeFor: translate('entity.sheet.history.workingFor', 'Working for'),
      turnedOn: translate('entity.sheet.history.started', 'Started'),
      last: translate('entity.sheet.history.lastStarted', 'Last started'),
    };
  }

  if (hasCapability(entity, 'location')) {
    return {
      activeFor: translate('entity.sheet.history.homeFor', 'Home for'),
      turnedOn: translate('entity.sheet.history.cameHome', 'Came home'),
      last: translate('entity.sheet.history.lastHome', 'Last home'),
    };
  }

  if (hasCapability(entity, 'sensor_binary')) {
    return {
      activeFor: translate('entity.sheet.history.detectedFor', 'Detected for'),
      turnedOn: translate('entity.sheet.history.detected', 'Detected'),
      last: translate('entity.sheet.history.lastDetected', 'Last detected'),
    };
  }

  return {
    activeFor: translate('entity.sheet.history.onFor', 'On for'),
    turnedOn: translate('entity.sheet.history.turnedOn', 'Turned on'),
    last: translate('entity.sheet.history.lastOn', 'Last on'),
  };
}

/**
 * Says how many times, in words.
 *
 * @param count - How many.
 * @returns "3 times", "once".
 */
export function timesText(count: number): string {
  return count === 1
    ? translate('entity.sheet.history.once', 'once')
    : translate('entity.sheet.history.times', '{{count}} times', { count });
}

/**
 * Says the time of day of a moment: 21:48.
 *
 * @param at - The moment, in milliseconds since the epoch.
 * @returns The time, in the browser's locale.
 */
export function clockText(at: number): string {
  return dateTimeFormat({ hour: '2-digit', minute: '2-digit' }).format(at);
}

/**
 * The band's three figures: how long it was active, how often it became so, and when last.
 *
 * @param entity - The entity, for the words.
 * @param segments - The band.
 * @returns The figures.
 */
export function bandStats(
  entity: Pick<EntityView, 'capabilities' | 'deviceClass'>,
  segments: readonly StateSegment[],
): StatTile[] {
  const words = activeWordsOf(entity);
  const figures = activeStats(segments);
  const lastOn = figures.lastOnAt ?? segments.findLast((segment) => segment.isActive)?.from;

  return [
    { label: words.activeFor, value: durationText(figures.activeMs) },
    { label: words.turnedOn, value: timesText(figures.turnedOn) },
    { label: words.last, value: lastOn === undefined ? '—' : clockText(lastOn) },
  ];
}

/** The main number of an entity, for its stepped line: what it is, its unit and its range. */
type MainNumber = NumericField & { readonly domain: readonly [number, number] };

/**
 * Reads a thermostat's target.
 *
 * @param state - The state.
 * @returns The target, or null.
 */
function targetOf(state: CapabilityState): number | null {
  return state.thermostat?.targetTemperature ?? null;
}

/**
 * Reads a level, nought while the thing is off.
 *
 * @param state - The state.
 * @returns The level, or null.
 */
function levelOf(state: CapabilityState): number | null {
  return state.on_off?.isOn === false ? 0 : (state.level?.level ?? null);
}

/**
 * Reads a cover's position.
 *
 * @param state - The state.
 * @returns The position, or null.
 */
function positionOf(state: CapabilityState): number | null {
  return state.cover?.position ?? null;
}

/**
 * Reads a fan's speed, nought while it is off.
 *
 * @param state - The state.
 * @returns The speed, or null.
 */
function speedOf(state: CapabilityState): number | null {
  return state.on_off?.isOn === false ? 0 : (state.fan?.percentage ?? null);
}

/**
 * Reads a number's value.
 *
 * @param state - The state.
 * @returns The value, or null.
 */
function numberOf(state: CapabilityState): number | null {
  return state.number?.value ?? null;
}

/** The whole of a percentage. */
const PERCENT: [number, number] = [0, 100];

/**
 * The number a drawer draws as a line, when the entity has one worth more than its band.
 *
 * A dimmable lamp's brightness, a cover's position when it has one, a fan's speed when it has
 * speeds, a thermostat's target, a number's value. A player is drawn by when it played, a lamp
 * that only switches by when it was on.
 *
 * @param entity - The entity.
 * @returns The number, or null when its band says more.
 */
function mainNumberOf(entity: EntityView): MainNumber | null {
  const thermostat = paramsOf(entity, 'thermostat');
  const cover = paramsOf(entity, 'cover');
  const fan = paramsOf(entity, 'fan');
  const number = paramsOf(entity, 'number');

  if (thermostat !== null) {
    return {
      label: translate('library.historySeries.target', 'Target'),
      unit: '°',
      read: targetOf,
      domain: [thermostat.minTemperature, thermostat.maxTemperature],
    };
  }

  if (hasCapability(entity, 'level')) {
    return {
      label:
        entity.domain === 'light'
          ? translate('library.historySeries.brightness', 'Brightness')
          : translate('library.historySeries.level', 'Level'),
      unit: '%',
      read: levelOf,
      domain: PERCENT,
    };
  }

  if (cover?.hasPosition === true) {
    return {
      label: translate('library.historySeries.position', 'Position'),
      unit: '%',
      read: positionOf,
      domain: PERCENT,
    };
  }

  if (fan !== null && fan.speedCount > 0) {
    return {
      label: translate('library.historySeries.speed', 'Speed'),
      unit: '%',
      read: speedOf,
      domain: PERCENT,
    };
  }

  if (number !== null) {
    return {
      label: translate('library.historySeries.value', 'Value'),
      unit: entity.unitOfMeasurement ?? '',
      read: numberOf,
      domain: [number.min, number.max],
    };
  }

  return null;
}

/**
 * The value held longest over the window, among those above zero: a lamp's usual level.
 *
 * @param points - The line, left to right.
 * @returns The value, or null when it never rose above zero.
 */
function usualValue(points: readonly LinePoint[]): number | null {
  const held = new Map<number, number>();

  points.forEach((point, index) => {
    const next = points[index + 1];

    if (next !== undefined && point.value > 0) {
      held.set(point.value, (held.get(point.value) ?? 0) + (next.at - point.at));
    }
  });

  let usual: number | null = null;
  let longest = 0;

  for (const [value, ms] of held) {
    if (ms > longest) {
      usual = value;
      longest = ms;
    }
  }

  return usual;
}

/**
 * Formats a number of the line with its unit.
 *
 * @param value - The number.
 * @param unit - Its unit.
 * @returns "60%", "21.5°", "12 min".
 */
function withUnit(value: number, unit: string): string {
  const rounded = Number(value.toFixed(1));

  return unit === '%' || unit === '°'
    ? `${String(rounded)}${unit}`
    : `${String(rounded)} ${unit}`.trim();
}

/**
 * Works out what the History drawer draws for an entity over a window.
 *
 * @param entity - The entity.
 * @param state - Its state now, for a window with no change.
 * @param points - Its state changes in the window, oldest first.
 * @param window - The window.
 * @returns The band or the line with their figures, or null when its history has nothing to draw.
 */
export function drawerContentOf(
  entity: EntityView,
  state: CapabilityState,
  points: readonly StateHistoryPoint[],
  window: TimeWindow,
): DrawerContent | null {
  const segments = stateSegments(
    points,
    window,
    { state: entity.state, isAvailable: entity.isAvailable },
    () => '',
  );
  const main = mainNumberOf(entity);

  if (main !== null) {
    const line = numericSeries(points, [main], window, entity.state).flatMap((point) => {
      const value = point['f0'];

      return typeof value === 'number' ? [{ at: point.at, value }] : [];
    });

    if (line.length === 0) {
      const now = main.read(state);

      return now === null
        ? null
        : {
            kind: 'step',
            points: [
              { at: window.from, value: now },
              { at: window.to, value: now },
            ],
            domain: main.domain,
            stats: [],
            label: main.label,
          };
    }

    const values = line.map((point) => point.value);
    const usual = usualValue(line);
    const [activeFor, turnedOn] = bandStats(entity, segments);
    const stats: StatTile[] =
      activeFor !== undefined && turnedOn !== undefined && segments.length > 0
        ? [
            activeFor,
            {
              label: translate('entity.sheet.history.usual', 'Usual {{what}}', {
                what: main.label.toLowerCase(),
              }),
              value: usual === null ? '—' : withUnit(usual, main.unit),
            },
            turnedOn,
          ]
        : [
            {
              label: translate('entity.sheet.history.lowest', 'Lowest'),
              value: withUnit(Math.min(...values), main.unit),
            },
            {
              label: translate('entity.sheet.history.average', 'Average'),
              value: withUnit(
                values.reduce((sum, value) => sum + value, 0) / values.length,
                main.unit,
              ),
            },
            {
              label: translate('entity.sheet.history.highest', 'Highest'),
              value: withUnit(Math.max(...values), main.unit),
            },
          ];

    return { kind: 'step', points: line, domain: main.domain, stats, label: main.label };
  }

  if (segments.length === 0) {
    return null;
  }

  return { kind: 'band', segments, stats: bandStats(entity, segments) };
}

/**
 * The four labels under a chart: three times across the window, then now.
 *
 * @param window - The window.
 * @param range - Which window it is, for whether the labels are times or days.
 * @returns The labels, left to right.
 */
export function axisLabels(window: TimeWindow, range: SheetRange): string[] {
  const isDays = range === '7d' || range === 'week' || range === 'month';
  const format = isDays
    ? dateTimeFormat({ weekday: 'short' })
    : dateTimeFormat({ hour: '2-digit', minute: '2-digit' });
  const span = window.to - window.from;

  return [
    format.format(window.from),
    format.format(window.from + span / 3),
    format.format(window.from + (span * 2) / 3),
    isDays
      ? translate('entity.sheet.history.today', 'Today')
      : translate('entity.sheet.history.now', 'Now'),
  ];
}
