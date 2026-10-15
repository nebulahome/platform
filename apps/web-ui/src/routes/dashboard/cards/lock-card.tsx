/**
 * A lock: whether the bolt is thrown, said in a word and a glyph, and the one button that changes
 * it.
 *
 * Locked is green, unlocked amber and jammed red - and each is also a word and its own glyph,
 * never the colour alone. A lock that asks for a code cannot take one from a card; its button opens
 * the entity's page, where the code is asked for.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { AppIcon, Button, cn, CardHeading, HoldButton } from '@nebulahome/ui';

import { defineMessage, text } from '@/i18n/messages';
import { paramsOf } from '@/library/entity-control';
import { CardFrame, TileRow } from '@/routes/dashboard/cards/card-parts';
import { cardTime, sizeKey, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import { entityPath } from '@/routes/library/entity/entity-path';
import { useEntityCommand } from '@/routes/library/entity/use-entity-command';

/** How each bolt position is drawn and said. */
const STATES = {
  locked: {
    label: defineMessage('dashboard.cards.lockCard.locked', 'Locked'),
    icon: 'lock',
    text: 'text-success',
    ring: 'border-success/35 bg-success/12',
  },
  unlocked: {
    label: defineMessage('dashboard.cards.lockCard.unlocked', 'Unlocked'),
    icon: 'lock-open',
    text: 'text-warning',
    ring: 'border-warning/35 bg-warning/12',
  },
  jammed: {
    label: defineMessage('dashboard.cards.lockCard.jammed', 'Jammed'),
    icon: 'triangle-alert',
    text: 'text-danger',
    ring: 'border-danger/35 bg-danger/12',
  },
} as const;

/**
 * Renders a lock card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function LockCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, title, subtitle, reading } = model;
  const commander = useEntityCommand(entity.entityId);
  const bolt = state.lock?.lockState ?? 'locked';
  const shown = STATES[bolt];
  const next = bolt === 'locked' ? 'unlock' : 'lock';
  const needsCode = paramsOf(entity, 'lock')?.hasCode === true;
  const disabled = !model.canControl || commander.busy.has('lock');
  const label =
    next === 'lock'
      ? t('dashboard.cards.lockCard.lock', 'Lock')
      : t('dashboard.cards.lockCard.unlock', 'Unlock');
  const action = needsCode ? (
    <Link
      to={entityPath(entity.entityId)}
      className="press flex h-control-sm items-center justify-center rounded-field border border-border-strong bg-surface-raised px-3 text-ui font-medium"
    >
      {label}…
    </Link>
  ) : next === 'unlock' ? (
    // A door is never opened by a tap: unlocking is held, the way the board draws the card.
    <HoldButton
      disabled={disabled}
      className="h-control-sm text-ui-sm"
      onConfirm={() => {
        commander.send('lock', { command: 'unlock' });
      }}
    >
      {t('dashboard.cards.lockCard.holdToUnlock', 'Hold to unlock')}
    </HoldButton>
  ) : (
    <Button
      variant="ghost"
      size="compact"
      disabled={disabled}
      onClick={() => {
        commander.send('lock', { command: next });
      }}
    >
      {label}
    </Button>
  );

  if (sizeKey(model.size) === '1x1') {
    return (
      <CardFrame label={title}>
        <TileRow
          icon={model.icon}
          kind={model.kind}
          isActive={bolt === 'locked'}
          isAvailable={reading.isAvailable}
          title={title}
          subtitle={text(shown.label)}
          tail={action}
        />
      </CardFrame>
    );
  }

  return (
    <CardFrame label={title}>
      <CardHeading title={title} subtitle={subtitle} />
      <div className="flex grow flex-col items-center justify-center gap-2.5">
        <span
          aria-hidden="true"
          className={cn(
            'flex size-16 items-center justify-center rounded-full border',
            shown.ring,
            shown.text,
          )}
        >
          <AppIcon id={shown.icon} size={28} />
        </span>
        <span className="flex flex-col items-center gap-0.5">
          <span className={cn('text-headline font-medium', shown.text)}>{text(shown.label)}</span>
          {model.changedAt === null ? null : (
            <span className="text-caption text-foreground-subtle">
              {t('dashboard.cards.lockCard.sinceChangedat', 'since {{changedAt}}', {
                changedAt: cardTime(model.changedAt),
              })}
            </span>
          )}
        </span>
      </div>
      <div className="flex flex-col">{action}</div>
    </CardFrame>
  );
}
