/**
 * An event, as the canvas draws it (`N-Entity-Event-Last`, `N-Entity-Event-More`): the last one in
 * big words with how long ago it came, and its history in the body, as a binary sensor's - a mark
 * on the track for each event, coloured by its type in the device's order, and under it each type
 * with how many times it came. One that has just come glows and rings its mark; before the first,
 * the words are grey and the types it waits for are listed. There is no History button.
 */
import { useTranslation } from 'react-i18next';

import type { StateHistoryPoint } from '@nebulahome/contracts';
import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import { humanise } from '@/lib/command-choices';
import { clockText, shortTime } from '@/lib/format-time';
import { paramsOf } from '@/library/entity-control';
import { durationText } from '@/library/history-stats';
import { HistoryCard } from '@/routes/library/entity/sheet/bodies/sensor-body';
import { AxisRow, ChartLoading, MarkChart } from '@/routes/library/entity/sheet/charts';
import { axisLabels, timesText } from '@/routes/library/entity/sheet/history';
import { MonoLabel } from '@/routes/library/entity/sheet/parts/sheet-parts';
import { SHEET_RANGES, type SheetBodyProps } from '@/routes/library/entity/sheet/sheet-types';
import { TILE_LIT, TILE_REST } from '@/routes/library/entity/sheet/tones';

/** The colours of the types, in the device's order: violet, cyan, amber, then the others. */
const TYPE_COLORS = ['bg-violet', 'bg-cyan', 'bg-lamp', 'bg-success', 'bg-primary', 'bg-media'];

/** How long an event is new: it glows and its mark rings. */
const NEW_FOR_MS = 60_000;

/**
 * An event entity's glyph, by its class: a bell for a doorbell, a press for a button.
 *
 * @param deviceClass - Its class.
 * @returns The glyph.
 */
export function eventGlyphOf(deviceClass: string | null): UiIconId {
  return deviceClass === 'doorbell'
    ? 'bell-ring'
    : deviceClass === 'button'
      ? 'mouse-pointer-click'
      : deviceClass === 'motion'
        ? 'footprints'
        : 'zap';
}

/**
 * The events in a window's history: each change whose moment is new. A change of whether the
 * device answers leaves the moment as it was, and is none.
 *
 * @param points - The changes, oldest first.
 * @returns Each event's moment and type.
 */
export function eventsOf(points: readonly StateHistoryPoint[]): { at: number; type: string }[] {
  return points.flatMap((point) => {
    const event = (point.state as { event?: { eventType?: unknown; at?: unknown } } | null)?.event;
    const before = (point.previousState as { event?: { at?: unknown } } | null)?.event;

    return typeof event?.eventType === 'string' &&
      typeof event.at === 'string' &&
      event.at !== before?.at
      ? [{ at: point.time.getTime(), type: event.eventType }]
      : [];
  });
}

/**
 * The body of an event.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function EventBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, state, history, now } = props;
  const isStale = !entity.isAvailable;
  const at = state.event?.at ?? null;
  const type = state.event?.eventType ?? null;
  const ago = at === null || type === null ? null : Math.max(0, now - Date.parse(at));
  const isWaiting = ago === null;
  const isNew = ago !== null && !isStale && ago < NEW_FOR_MS;
  const events = eventsOf(history.states);
  // The device's types in its order; one it reported without listing it comes after them.
  const types = [
    ...new Set([
      ...(paramsOf(entity, 'event')?.eventTypes ?? []),
      ...events.map((event) => event.type),
    ]),
  ];
  /**
   * The colour of a type.
   *
   * @param each - The type.
   * @returns Its colour, as a class.
   */
  const colorOf = (each: string): string =>
    TYPE_COLORS[types.indexOf(each) % TYPE_COLORS.length] ?? 'bg-violet';
  const glyph = eventGlyphOf(entity.deviceClass);

  return (
    <div className="flex grow flex-col gap-4.5 pt-2">
      <div className="flex items-center gap-4">
        <span className="relative grid size-16 shrink-0 place-items-center text-violet">
          {isNew ? (
            // For a moment, a soft glow round it.
            <span
              aria-hidden="true"
              className="absolute -inset-1.5 rounded-full bg-current/16 blur-md"
            />
          ) : null}
          <span
            className={cn(
              'entity-tint relative flex size-16 items-center justify-center rounded-full border',
              isWaiting || isStale ? TILE_REST : TILE_LIT.violet,
            )}
          >
            <span key={at ?? ''} className="entity-pop flex">
              <AppIcon id={glyph} size={26} />
            </span>
          </span>
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span
            key={at ?? ''}
            className={cn(
              'entity-tick truncate text-[28px] font-medium tracking-[-0.02em] select-text',
              (isWaiting || isStale) && 'text-foreground-muted',
            )}
          >
            {ago === null || type === null
              ? t('entity.sheet.event.nothingYet', 'Nothing yet')
              : humanise(type)}
          </span>
          <span className="text-ui-sm leading-[1.45] text-foreground-subtle">
            {ago === null
              ? t('entity.sheet.event.noneSinceAdded', 'No event since it was added')
              : isNew
                ? t('entity.sheet.event.justNow', 'Just now')
                : t('entity.sheet.event.agoAt', '{{ago}} ago · {{time}}', {
                    ago: durationText(ago),
                    time:
                      ago < 86_400_000
                        ? clockText(now - ago)
                        : shortTime(new Date(now - ago), new Date(now)),
                  })}
          </span>
        </div>
      </div>
      <HistoryCard range={history.range} ranges={SHEET_RANGES} onRange={history.onRange}>
        {history.isLoading === true ? (
          <ChartLoading className="h-10" />
        ) : (
          <MarkChart
            key={history.range}
            marks={events.map((event) => ({
              at: event.at,
              color: isStale ? 'bg-foreground-muted' : colorOf(event.type),
              title: humanise(event.type),
            }))}
            window={history.window}
            isNewestRinged={isNew}
            empty={t('entity.sheet.event.noneInWindow', 'No events in the last {{range}}', {
              range: history.range,
            })}
            label={t('entity.sheet.event.inWindow', '{{count}} events in the last {{range}}', {
              count: events.length,
              range: history.range,
            })}
          />
        )}
        <AxisRow labels={axisLabels(history.window, history.range)} />
        {history.isLoading === true ? null : isWaiting ? (
          <div className="flex flex-col gap-2 pt-0.5">
            <MonoLabel>{t('entity.sheet.event.waitsFor', 'Waits for')}</MonoLabel>
            <div className="flex flex-wrap gap-1.5">
              {types.map((type) => (
                <span
                  key={type}
                  className="inline-flex h-7 items-center gap-1.75 rounded-full border border-border px-2.75 text-ui-sm text-foreground-muted"
                >
                  <span className={cn('size-2 rounded-[3px]', colorOf(type))} />
                  {humanise(type)}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.25 pt-0.5">
            {types.map((type) => {
              const count = events.filter((event) => event.type === type).length;

              return (
                <div key={type} className="flex items-center gap-2.5">
                  <span className={cn('size-2.5 shrink-0 rounded-[3px]', colorOf(type))} />
                  <span className="min-w-0 grow truncate text-ui select-text">
                    {humanise(type)}
                  </span>
                  <span
                    className={cn(
                      'text-ui-sm tabular select-text',
                      count === 0 ? 'text-foreground-subtle' : 'text-foreground-muted',
                    )}
                  >
                    {count === 0
                      ? t('entity.sheet.event.none', 'None')
                      : count === 1
                        ? t('entity.sheet.event.once', 'Once')
                        : timesText(count)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </HistoryCard>
    </div>
  );
}
