/**
 * A lock: whether the bolt is thrown, said in a word and its colour, and the one button that
 * changes it.
 *
 * Locked is green, unlocked amber and jammed red - each also a word, never the colour alone. A
 * door is never opened by a tap: unlocking is held. The tall card adds the round lock beside the
 * word, and the button across its foot. A lock that asks for a code cannot take one from a card:
 * it draws no button, and the card's face opens the entity, where the code is asked for.
 *
 * The bolt's state is all the lock's capability carries: its device's battery is another
 * entity, so the card draws none (`K-Capabilities`, "no battery").
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, HoldButton } from '@nebulahome/ui';

import { defineMessage, text } from '@/i18n/messages';
import { paramsOf } from '@/library/entity-control';
import { BigValue, Caption, CardHead, NoAnswer } from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import {
  canUse,
  cardTime,
  sizeKey,
  type EntityCardModel,
} from '@/routes/dashboard/cards/entity-model';

/** How each bolt position is said and coloured. */
const STATES = {
  locked: {
    label: defineMessage('dashboard.cards.lockCard.locked', 'Locked'),
    text: 'text-success',
    ring: 'border-success/60 bg-success/8 shadow-[0_0_28px_color-mix(in_srgb,var(--color-success)_20%,transparent)]',
    glow: undefined,
  },
  unlocked: {
    label: defineMessage('dashboard.cards.lockCard.unlocked', 'Unlocked'),
    text: 'text-warning',
    ring: 'border-warning/60 bg-warning/8 shadow-[0_0_28px_color-mix(in_srgb,var(--color-warning)_20%,transparent)]',
    glow: undefined,
  },
  jammed: {
    label: defineMessage('dashboard.cards.lockCard.jammed', 'Jammed'),
    text: 'text-danger',
    ring: 'border-danger/60 bg-danger/8 shadow-[0_0_28px_color-mix(in_srgb,var(--color-danger)_20%,transparent)]',
    glow: 'var(--color-danger)',
  },
} as const;

/** The pill a lock's button is drawn as, on the tile. */
const BUTTON =
  'press-scale inline-flex h-7.5 shrink-0 items-center justify-center gap-2 rounded-pill border border-border-strong bg-surface-raised px-3.5 text-ui-sm font-medium whitespace-nowrap text-foreground transition-colors duration-200 hover:enabled:bg-surface-high disabled:opacity-40';

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
  const { entity, state, title, command } = model;
  const isTile = sizeKey(model.size) === '1x1';
  const lock = state.lock;
  const bolt = lock?.lockState;
  const look = bolt === undefined ? null : STATES[bolt];
  const needsCode = paramsOf(entity, 'lock')?.hasCode === true;
  const disabled = !canUse(model, 'lock');
  const word = look === null ? '—' : text(look.label);
  const colour = model.isOffline || look === null ? 'text-foreground-subtle' : look.text;
  const since =
    model.changedAt === null
      ? ''
      : t('dashboard.cards.lockCard.sinceChangedat', 'since {{changedAt}}', {
          changedAt: cardTime(model.changedAt),
        });
  // Where the bolt is going: what the lock says while it moves, or what was just asked of it.
  const going =
    lock?.motion ??
    (command.sending === 'lock' ? (bolt === 'locked' ? 'unlocking' : 'locking') : undefined);
  const size = isTile ? 'h-7.5' : 'h-9 w-full';

  /**
   * Sends a command to the bolt.
   *
   * @param next - Lock or unlock.
   */
  const send = (next: 'lock' | 'unlock'): void => {
    command.send('lock', { command: next });
  };

  /**
   * The lock's one button: hold to unlock a locked door, lock an unlocked one, try a jammed one
   * again; while the bolt moves, what it is doing in its place.
   *
   * @returns The button, or nothing when the card cannot command the lock.
   */
  const action = (): ReactNode => {
    if (!model.canControl || needsCode || bolt === undefined) {
      return null;
    }

    if (going !== undefined) {
      return (
        <span className={cn(BUTTON, size, 'text-foreground-muted')}>
          <span className="inline-flex shrink-0 animate-spin text-cyan">
            <AppIcon id="loader-circle" size={14} />
          </span>
          {going === 'unlocking'
            ? t('dashboard.cards.lockCard.unlocking', 'Unlocking…')
            : going === 'locking'
              ? t('dashboard.cards.lockCard.locking', 'Locking…')
              : t('dashboard.cards.lockCard.opening', 'Opening…')}
        </span>
      );
    }

    if (bolt === 'locked') {
      return (
        <HoldButton
          disabled={disabled}
          className={cn(size, 'px-3.5 text-ui-sm disabled:opacity-40')}
          onConfirm={() => {
            send('unlock');
          }}
        >
          <span className="inline-flex items-center gap-2">
            {isTile ? null : <AppIcon id="lock-open" size={16} />}
            {isTile
              ? t('dashboard.cards.lockCard.holdOnTile', 'Hold to unlock')
              : t('dashboard.cards.lockCard.holdToUnlock', 'Hold to unlock')}
          </span>
        </HoldButton>
      );
    }

    return (
      <button
        type="button"
        disabled={disabled}
        className={cn(BUTTON, size)}
        onClick={() => {
          send('lock');
        }}
      >
        {isTile ? null : <AppIcon id="lock" size={16} />}
        {bolt === 'jammed'
          ? t('dashboard.cards.kit.tryAgain', 'Try again')
          : t('dashboard.cards.lockCard.lock', 'Lock')}
      </button>
    );
  };

  const head = (
    <CardHead
      model={model}
      isActive={bolt === undefined ? null : true}
      tone={bolt === 'unlocked' ? 'warning' : bolt === 'jammed' ? 'danger' : undefined}
      tail={null}
    />
  );
  const button = action();

  if (isTile) {
    return (
      <CardFrame label={title} glow={model.isOffline ? undefined : look?.glow}>
        {head}
        <div className="grow" />
        {command.hasFailed ? (
          <NoAnswer command={command} />
        ) : (
          <div className="flex min-w-0 items-center justify-between gap-2.5">
            <span
              className={cn(
                'flex min-w-0 items-center gap-2 text-[20px] font-medium whitespace-nowrap transition-colors duration-200',
                colour,
              )}
            >
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-current" />
              <span className="truncate">{word}</span>
            </span>
            {button ?? <Caption>{since}</Caption>}
          </div>
        )}
      </CardFrame>
    );
  }

  return (
    <CardFrame label={title} glow={model.isOffline ? undefined : look?.glow}>
      {head}
      <div className="mt-3 flex min-w-0 items-center justify-between gap-2.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <BigValue value={word} size={26} className={colour} />
          <Caption>
            {model.isOffline && model.changedAt !== null
              ? t('dashboard.cards.kit.lastSeen', 'last seen {{time}}', {
                  time: cardTime(model.changedAt),
                })
              : since}
          </Caption>
        </div>
        <span
          aria-hidden="true"
          className={cn(
            'flex size-19 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-200',
            model.isOffline || look === null
              ? 'border-border-strong bg-surface-raised text-foreground-subtle'
              : cn(look.ring, look.text),
          )}
        >
          <AppIcon
            id={bolt === 'jammed' ? 'triangle-alert' : bolt === 'locked' ? 'lock' : 'lock-open'}
            size={30}
          />
        </span>
      </div>
      <div className="grow" />
      {command.hasFailed ? <NoAnswer command={command} /> : button}
    </CardFrame>
  );
}
