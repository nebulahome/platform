/**
 * A sensor that is either on or off: motion, a door, a leak.
 *
 * It has no value to plot, only when it fired. The tile says what it senses now, in the words that
 * sensor uses - "Clear", "Open" - and the tall card draws the last day as one bar an hour, each as
 * tall as the share of that hour it spent active, so the day reads at a glance.
 */
import { cn, CardHeading } from '@nebulahome/ui';

import { activityShares } from '@/dashboard/activity';
import { stateSegments } from '@/library/history-series';
import { CardFrame, EndReading, TileRow } from '@/routes/dashboard/cards/card-parts';
import { cardTime, sizeKey, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import { useStateChanges } from '@/routes/dashboard/cards/use-card-history';

/** How many bars a day is drawn in. */
const HOURS = 24;

/** The hours the axis names. */
const AXIS = ['−24 h', '−18 h', '−12 h', '−6 h', 'now'] as const;

/**
 * Renders a binary sensor card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function BinaryCard(props: { readonly model: EntityCardModel }) {
  const { model } = props;
  const { entity, state, title, subtitle, reading } = model;
  const key = sizeKey(model.size);
  const isOn = state.sensor_binary?.isOn ?? false;
  const history = useStateChanges(entity.entityId, '24h', key !== '1x1' && model.canReadHistory);
  // The reading in words is the sensor's own: "Detected", "Closed".
  const word = reading.text;
  const since = model.changedAt === null ? null : `since ${cardTime(model.changedAt)}`;

  if (key === '1x1') {
    return (
      <CardFrame label={title}>
        <TileRow
          icon={model.icon}
          kind={model.kind}
          isActive={isOn}
          isAvailable={reading.isAvailable}
          title={title}
          subtitle={subtitle}
          tail={
            <EndReading value={word} note={since} className={isOn ? 'text-primary' : undefined} />
          }
        />
      </CardFrame>
    );
  }

  const shares =
    history === undefined
      ? []
      : activityShares(
          stateSegments(
            history.points,
            history.window,
            { state: entity.state, isAvailable: reading.isAvailable },
            () => '',
          ),
          history.window,
          HOURS,
        );

  return (
    <CardFrame label={title}>
      <CardHeading title={title} subtitle={subtitle} />
      <div className="mt-3 flex flex-col gap-0.5">
        <span
          className={cn(
            'text-headline leading-tight font-medium',
            isOn ? 'text-primary' : 'text-foreground-muted',
          )}
        >
          {word}
        </span>
        {since === null ? null : (
          <span className="text-caption text-foreground-subtle">{since}</span>
        )}
      </div>
      <div className="grow" />
      {shares.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
          <div
            role="img"
            aria-label={`Active in ${String(shares.filter((share) => share > 0).length)} of the last 24 hours`}
            className="flex h-13 items-end gap-0.5"
          >
            {shares.map((share, index) => (
              <div
                // The bars are the hours of the window, in order, and never move.
                // eslint-disable-next-line react/no-array-index-key -- see above
                key={index}
                className={cn(
                  'min-w-0 grow rounded-[2px]',
                  share > 0 ? 'bg-primary' : 'bg-control',
                  index === shares.length - 1 && share > 0 ? 'bg-tag-indigo' : undefined,
                )}
                /* eslint-disable-next-line react/forbid-dom-props -- a bar is as tall as its share of the hour,
                a number no class can carry (RULES.md 15.3). */
                style={{ height: share > 0 ? `${String(Math.max(18, share * 100))}%` : '8px' }}
              />
            ))}
          </div>
          <div className="flex justify-between font-mono text-label text-foreground-subtle">
            {AXIS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </div>
      )}
    </CardFrame>
  );
}
