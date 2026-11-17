/**
 * A sensor that is either on or off: a door, a window, motion, a leak (`K-All` Binary sensor).
 *
 * It has no value to plot, only when it fired. The tile says what it senses now in the words that
 * sensor uses - "Closed", "Open" - beside a dot, and since when; the tall card adds the day as 24
 * blocks, one an hour, lit when it was active, how many times it went off today, and when it last
 * opened and closed. Active is amber, and the card takes the colour at its edge.
 */
import { useTranslation } from 'react-i18next';

import { cn } from '@nebulahome/ui';

import { text } from '@/i18n/messages';
import { BINARY_WORDS, ON_OFF_WORDS } from '@/library/entity-reading';
import { stateSegments } from '@/library/history-series';
import { BigValue, Caption, CardHead, forHowLong } from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { cardTime, sizeKey, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import { onOffDay } from '@/routes/dashboard/cards/on-off-day';
import { stateCaption } from '@/routes/dashboard/cards/reading-parts';
import { useStateChanges } from '@/routes/dashboard/cards/use-card-history';

/** What an active sensor is lit in. */
const ACTIVE = 'var(--color-warning)';

/** The kinds of sensor that open and close, whose last change reads "Opened". */
const OPENINGS: ReadonlySet<string> = new Set(['door', 'window', 'opening', 'garage_door']);

/**
 * Renders a binary sensor card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function BinaryCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, title, reading, hidden } = model;
  const key = sizeKey(model.size);
  const history = useStateChanges(
    entity.entityId,
    '24h',
    key === '1x2' && model.canReadHistory && !hidden.has('day'),
  );
  const hasValue = state.sensor_binary !== undefined;
  const isOn = state.sensor_binary?.isOn ?? false;
  const isLit = hasValue && isOn && !model.isOffline;
  const since =
    model.changedAt === null
      ? ''
      : isOn
        ? forHowLong(model.changedAt)
        : t('dashboard.cards.binaryCard.since', 'since {{time}}', {
            time: cardTime(model.changedAt),
          });
  const caption = stateCaption(model, hasValue) ?? since;
  const word = hasValue ? reading.text : '—';
  const head = <CardHead model={model} isActive={hasValue && isOn} />;

  if (key === '1x1') {
    return (
      <CardFrame label={title} glow={isLit ? ACTIVE : undefined}>
        {head}
        <div className="grow" />
        <div className="flex min-w-0 items-center justify-between gap-2.5">
          <span
            className={cn(
              'flex min-w-0 items-center gap-2 text-[20px] leading-[normal] font-medium whitespace-nowrap transition-colors duration-200',
              isLit
                ? 'text-warning'
                : hasValue && !model.isOffline
                  ? 'text-foreground'
                  : 'text-foreground-subtle',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-2 shrink-0 rounded-full transition-colors duration-200',
                isLit
                  ? 'bg-warning'
                  : hasValue && !model.isOffline
                    ? 'bg-success'
                    : 'bg-foreground-disabled',
              )}
            />
            <span className="truncate">{word}</span>
          </span>
          <Caption>{caption}</Caption>
        </div>
      </CardFrame>
    );
  }

  const day = history === undefined ? undefined : onOffDay(history, entity, !model.isOffline);
  const stretches =
    history === undefined
      ? []
      : stateSegments(
          history.points,
          history.window,
          { state: entity.state, isAvailable: !model.isOffline },
          () => '',
        );
  // The moments it went active or quiet: a stretch that says the same as the one before is not one.
  const segments = stretches.filter(
    (segment, index) => index > 0 && segment.isActive !== stretches[index - 1]?.isActive,
  );
  const midnight = new Date(history?.window.to ?? 0).setHours(0, 0, 0, 0);
  const times = segments.filter((segment) => segment.isActive && segment.from >= midnight).length;
  const [onWord, offWord] = BINARY_WORDS[entity.deviceClass ?? ''] ?? ON_OFF_WORDS;
  const changes = [
    {
      label: OPENINGS.has(entity.deviceClass ?? '')
        ? t('dashboard.cards.binaryCard.opened', 'Opened')
        : text(onWord),
      at: segments.findLast((segment) => segment.isActive)?.from,
    },
    { label: text(offWord), at: segments.findLast((segment) => !segment.isActive)?.from },
  ];

  return (
    <CardFrame label={title} glow={isLit ? ACTIVE : undefined}>
      {head}
      <div className="mt-3.5 flex flex-col gap-1.5">
        <BigValue
          value={word}
          size={30}
          className={
            isLit
              ? 'text-warning'
              : hasValue && !model.isOffline
                ? undefined
                : 'text-foreground-subtle'
          }
        />
        <Caption>
          {day === undefined || !hasValue || model.isOffline
            ? caption
            : t('dashboard.cards.binaryCard.timesToday', '{{since}} · {{count}} times today', {
                since,
                count: times,
              })}
        </Caption>
      </div>
      <div className="grow" />
      {day === undefined ? null : (
        <div className="flex flex-col gap-2">
          <div
            role="img"
            aria-label={t('dashboard.cards.binaryCard.lastDay', 'The last 24 hours')}
            className="flex gap-0.5"
          >
            {day.hours.map((wasOn, index) => (
              <span
                // The hours keep their place: the index is the hour.
                // eslint-disable-next-line react/no-array-index-key
                key={index}
                className={cn(
                  'h-3.5 flex-1 rounded-[3px]',
                  wasOn ? 'bg-warning' : 'bg-surface-raised',
                )}
              />
            ))}
          </div>
          <div>
            {changes.map((change) =>
              change.at === undefined ? null : (
                <div
                  key={change.label}
                  className="flex min-w-0 items-center justify-between gap-2.5 border-t border-border py-[5px]"
                >
                  <Caption className="leading-4 text-foreground-muted">{change.label}</Caption>
                  <Caption className="leading-4 text-foreground-subtle">
                    {cardTime(new Date(change.at))}
                  </Caption>
                </div>
              ),
            )}
          </div>
        </div>
      )}
    </CardFrame>
  );
}
