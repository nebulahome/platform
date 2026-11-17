/**
 * Something that only switches: a relay, a plug, a coffee machine (`K-All` Switch).
 *
 * The tile is its toggle, and On or Off with how long it has been so. The tall card trades the
 * toggle for the round power button, and adds the day: 24 blocks, one an hour, lit when it was on,
 * and how long it was on in all.
 */
import { useTranslation } from 'react-i18next';

import { powerCommand } from '@/library/entity-control';
import {
  BigValue,
  Caption,
  CardHead,
  CardSwitch,
  CommandNote,
  DayBlocks,
  forHowLong,
  NoAnswer,
  PowerButton,
} from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import {
  canUse,
  cardTime,
  sizeKey,
  type EntityCardModel,
} from '@/routes/dashboard/cards/entity-model';
import { hoursAndMinutes, onOffDay } from '@/routes/dashboard/cards/on-off-day';
import { useStateChanges } from '@/routes/dashboard/cards/use-card-history';

/** What a switch that is on is lit in. */
const ON = 'var(--color-primary)';

/**
 * Renders a switch card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function SwitchCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, title, command, hidden } = model;
  const key = sizeKey(model.size);
  const day = useStateChanges(
    entity.entityId,
    '24h',
    key === '1x2' && model.canReadHistory && !hidden.has('day'),
  );
  const hasValue = state.on_off !== undefined;
  const isOn = state.on_off?.isOn ?? false;

  /**
   * The line beside On or Off: how long it has been so, or why there is nothing to say.
   *
   * @returns The line.
   */
  const caption = (): string => {
    if (model.isOffline) {
      return model.changedAt === null
        ? t('dashboard.cards.kit.unreachable', 'Not reachable')
        : t('dashboard.cards.kit.lastSeen', 'last seen {{time}}', {
            time: cardTime(model.changedAt),
          });
    }

    if (!hasValue) {
      return t('dashboard.cards.kit.waitingForDevice', 'Waiting for the device');
    }

    if (model.changedAt === null) {
      return '';
    }

    return isOn
      ? forHowLong(model.changedAt)
      : t('dashboard.cards.switchCard.sinceChangedat', 'since {{changedAt}}', {
          changedAt: cardTime(model.changedAt),
        });
  };

  /**
   * On or Off in large letters, grey when off or out of reach, a dash before it has said either.
   *
   * @param size - How large, as the card's size wants it.
   * @returns The word.
   */
  const figure = (size: 22 | 30) => (
    <BigValue
      value={!hasValue ? '—' : isOn ? t('common.on', 'On') : t('common.off', 'Off')}
      size={size}
      className={!hasValue || !isOn || model.isOffline ? 'text-foreground-subtle' : undefined}
    />
  );
  const note = (
    <CommandNote
      command={command}
      sending={
        isOn
          ? t('dashboard.cards.switchCard.turningOff', 'Turning off…')
          : t('dashboard.cards.switchCard.turningOn', 'Turning on…')
      }
    >
      <Caption>{caption()}</Caption>
    </CommandNote>
  );

  if (key === '1x1') {
    return (
      <CardFrame label={title}>
        <CardHead model={model} isActive={isOn} tail={<CardSwitch model={model} />} />
        <div className="grow" />
        {command.hasFailed ? (
          <NoAnswer command={command} />
        ) : (
          <div className="flex min-w-0 items-baseline justify-between gap-2.5">
            {figure(22)}
            {note}
          </div>
        )}
      </CardFrame>
    );
  }

  const today = day === undefined ? undefined : onOffDay(day, entity, !model.isOffline);

  return (
    <CardFrame label={title}>
      {/* The power button is the switch here; the head keeps the toggle only to show the eye. */}
      <CardHead
        model={model}
        isActive={isOn}
        tail={model.canControl ? undefined : <CardSwitch model={model} />}
      />
      <div className="mt-3.5 flex min-w-0 items-center justify-between gap-2.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          {figure(30)}
          {note}
        </div>
        {model.canControl ? (
          <PowerButton
            isOn={isOn}
            color={ON}
            label={
              isOn
                ? t('dashboard.cards.switchCard.turnOff', 'Turn off')
                : t('dashboard.cards.switchCard.turnOn', 'Turn on')
            }
            disabled={!canUse(model, 'on_off')}
            onPress={() => {
              command.send('on_off', powerCommand(!isOn));
            }}
          />
        ) : null}
      </div>
      <div className="grow" />
      {command.hasFailed ? (
        <NoAnswer command={command} />
      ) : today === undefined ? null : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2.5">
            <Caption>{t('dashboard.cards.switchCard.today', 'Today')}</Caption>
            <Caption className="text-foreground-muted">
              {t('dashboard.cards.switchCard.onFor', 'On {{time}}', {
                time: hoursAndMinutes(today.onMs),
              })}
            </Caption>
          </div>
          <DayBlocks
            hours={today.hours}
            color={ON}
            label={t('dashboard.cards.switchCard.lastDay', 'The last 24 hours')}
          />
        </div>
      )}
    </CardFrame>
  );
}
