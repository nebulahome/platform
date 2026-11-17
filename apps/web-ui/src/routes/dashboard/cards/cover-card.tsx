/**
 * A blind, a shutter, a garage door: how open it is, and the movements.
 *
 * The tile is how open it is in figures and the three round buttons - up, stop, down - because
 * stopping half-way is what people do most after starting one. The tall card adds the window,
 * drawn with the blind let down as far as it is closed, and the slats' tilt. While it moves it
 * says so in the cool colour and Stop is the button lit.
 *
 * What the cover cannot do is not drawn (`K-Capabilities`): one without a position says where it
 * is in a word and has no window, and its tall card has three wide buttons; one without tilt has
 * no tilt line.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, IconButton } from '@nebulahome/ui';

import { defineMessage, text } from '@/i18n/messages';
import { paramsOf } from '@/library/entity-control';
import {
  BigValue,
  Caption,
  CardHead,
  CommandNote,
  NoAnswer,
} from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import {
  canUse,
  cardTime,
  sizeKey,
  type EntityCardModel,
} from '@/routes/dashboard/cards/entity-model';

/** The three movements, with their glyphs. */
const MOVES = [
  {
    command: 'open',
    label: defineMessage('dashboard.cards.coverCard.open', 'Open'),
    icon: 'chevron-up',
  },
  {
    command: 'stop',
    label: defineMessage('dashboard.cards.coverCard.stop', 'Stop'),
    icon: 'square',
  },
  { command: 'close', label: defineMessage('common.close', 'Close'), icon: 'chevron-down' },
] as const;

/** A movement. */
type Move = (typeof MOVES)[number]['command'];

/**
 * Renders the window with the blind let down as far as it is closed: the slats above the rail,
 * the rail where the blind ends.
 *
 * @param props - How far it is open.
 * @param props.position - 0 closed, 100 open.
 * @returns The drawing.
 */
function Window(props: { readonly position: number }) {
  const { position } = props;
  // The rail travels the 100 px between the window's top and its sill, 3 px in from each.
  const rail = Math.round(3 + (100 - position));
  const slats = Math.floor((rail - 3) / 8);

  return (
    <div
      aria-hidden="true"
      className="relative h-[114px] w-16 shrink-0 overflow-hidden rounded-[6px] border-2 border-border-strong bg-linear-to-b from-[#1d2440] to-[#121628]"
    >
      <span className="absolute inset-y-0 left-1/2 w-0.5 bg-border-strong" />
      <div className="absolute inset-x-[3px] top-[3px] flex flex-col gap-[3px]">
        {[...Array.from({ length: slats }).keys()].map((slat) => (
          <span key={slat} className="h-[5px] shrink-0 rounded-[1px] bg-foreground-muted/55" />
        ))}
      </div>
      <span
        className="absolute inset-x-[3px] h-1 rounded-[2px] bg-foreground transition-[top] duration-300 ease-out"
        /* eslint-disable-next-line react/forbid-dom-props -- the rail sits where the blind ends. */
        style={{ top: `${String(rail)}px` }}
      />
    </div>
  );
}

/**
 * Renders a cover card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function CoverCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, title, command, hidden } = model;
  const [sent, setSent] = useState<Move>('stop');
  const key = sizeKey(model.size);
  const params = paramsOf(entity, 'cover');
  const cover = state.cover;
  const hasPosition = params?.hasPosition !== false;
  const isSending = command.sending === 'cover';
  const motion = isSending
    ? sent === 'open'
      ? 'opening'
      : sent === 'close'
        ? 'closing'
        : 'stopped'
    : (cover?.motion ?? 'stopped');
  const isMoving = motion !== 'stopped';
  const isOpen = (cover?.position ?? 0) > 0;
  const word = isOpen
    ? t('dashboard.cards.coverCard.isOpen', 'Open')
    : t('dashboard.cards.coverCard.closed', 'Closed');
  const since =
    model.changedAt === null
      ? ''
      : t('dashboard.cards.coverCard.since', 'since {{time}}', { time: cardTime(model.changedAt) });
  const moving =
    motion === 'opening'
      ? `${t('dashboard.cards.coverCard.opening', 'Opening')}…`
      : `${t('dashboard.cards.coverCard.closing', 'Closing')}…`;
  const isDim = model.isOffline || cover === undefined;
  const seenAt = model.changedAt === null ? '' : cardTime(model.changedAt);
  const lastSeen =
    model.changedAt === null
      ? t('dashboard.cards.kit.unreachable', 'Not reachable')
      : t('dashboard.cards.kit.lastSeen', 'last seen {{time}}', { time: seenAt });
  // The boards draw a cover's chip cyan: the tone the sensors are drawn in.
  const head = (
    <CardHead
      model={{ ...model, kind: { ...model.kind, tone: 'sensor' } }}
      isActive={cover === undefined ? null : isOpen}
      tail={null}
    />
  );

  /**
   * The line beside the figure: where it is, that it is moving, or when it was last heard.
   *
   * @param stopped - What it says while the cover stands still.
   * @param seen - When it was last heard, as the size has room to say it.
   * @returns The line.
   */
  const caption = (stopped: string, seen: string) => (
    <CommandNote
      command={command}
      sending={sent === 'stop' ? t('dashboard.cards.coverCard.stopping', 'Stopping…') : moving}
    >
      {model.isOffline ? (
        <Caption>{seen}</Caption>
      ) : cover === undefined ? (
        <Caption>{t('dashboard.cards.kit.waitingForDevice', 'Waiting for the device')}</Caption>
      ) : isMoving ? (
        <Caption className="text-cyan">{moving}</Caption>
      ) : (
        <Caption>{stopped}</Caption>
      )}
    </CommandNote>
  );

  /**
   * The cover's figure: how open, in figures; or where it is in a word, for one that does not
   * say how far.
   *
   * @param size - How large, as the card's size wants it.
   * @returns The figure.
   */
  const figure = (size: 'tile' | 'card') =>
    cover === undefined ? (
      <BigValue value="—" size={22} className="text-foreground-subtle" />
    ) : hasPosition ? (
      <BigValue
        value={String(Math.round(cover.position))}
        unit="%"
        size={size === 'tile' ? 26 : 36}
        // The tile's figure is 24 px, between the kit's sizes.
        className={cn(
          size === 'tile' && 'text-[24px]',
          isDim ? 'text-foreground-subtle' : 'text-foreground',
        )}
      />
    ) : (
      <BigValue
        value={word}
        size={size === 'tile' ? 22 : 30}
        className={isDim ? 'text-foreground-subtle' : undefined}
      />
    );

  /**
   * The movement buttons: Stop lit while the cover moves, the others still while a command is out.
   *
   * @param look - Round, at the tile's 30 px or the tall card's 34 px; or wide, sharing a row.
   * @returns The buttons.
   */
  const buttons = (look: 'small' | 'large' | 'wide') =>
    MOVES.map((move) => {
      const isLit = move.command === 'stop' && isMoving;

      return (
        <IconButton
          key={move.command}
          variant={isLit ? 'primary' : 'raised'}
          size={null}
          label={text(move.label)}
          className={cn(
            'transition-colors duration-200 disabled:opacity-40',
            !isLit && 'text-foreground',
            look === 'small' ? 'size-7.5' : look === 'large' ? 'size-8.5' : 'h-9 flex-1',
          )}
          disabled={!canUse(model, 'cover') || (isSending && move.command !== 'stop')}
          onClick={() => {
            setSent(move.command);
            command.send('cover', { command: move.command });
          }}
        >
          <AppIcon id={move.icon} size={look === 'small' ? 15 : 17} />
        </IconButton>
      );
    });

  if (key === '1x1') {
    return (
      <CardFrame label={title}>
        {head}
        <div className="grow" />
        {command.hasFailed ? (
          <NoAnswer command={command} />
        ) : (
          <div className="flex min-w-0 items-center justify-between gap-2.5">
            {hasPosition ? (
              <span className="flex min-w-0 items-baseline gap-2">
                {figure('tile')}
                {caption(word.toLowerCase(), seenAt)}
              </span>
            ) : (
              figure('tile')
            )}
            {model.canControl ? (
              <div className="flex shrink-0 gap-1.5">{buttons('small')}</div>
            ) : (
              <Caption>{since}</Caption>
            )}
          </div>
        )}
      </CardFrame>
    );
  }

  const failed = (
    <span className="inline-flex min-w-0 animate-rise items-center gap-1.5 text-caption text-danger">
      <AppIcon id="triangle-alert" size={12} />
      <span className="truncate">{t('dashboard.cards.kit.didNotAnswer', 'Did not answer')}</span>
    </span>
  );

  if (!hasPosition) {
    return (
      <CardFrame label={title}>
        {head}
        <div className="mt-3.5 flex flex-col gap-1.5">
          {figure('card')}
          {caption(since, lastSeen)}
        </div>
        <div className="grow" />
        {command.hasFailed ? (
          <NoAnswer command={command} />
        ) : model.canControl ? (
          <div className="flex gap-1.5">{buttons('wide')}</div>
        ) : null}
      </CardFrame>
    );
  }

  const tilt =
    params?.hasTilt === true && cover?.tilt !== undefined && !hidden.has('tilt')
      ? t('dashboard.cards.coverCard.tilt', 'Tilt {{tilt}}°', { tilt: Math.round(cover.tilt) })
      : null;

  return (
    <CardFrame label={title}>
      {head}
      <div className="mt-3.5 flex min-h-0 grow items-stretch gap-3.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          {figure('card')}
          {command.hasFailed ? failed : caption(since, lastSeen)}
          {tilt === null ? null : (
            <div className="mt-auto">
              <Caption>{tilt}</Caption>
            </div>
          )}
        </div>
        <span className="grow" />
        <Window position={cover?.position ?? 0} />
        {model.canControl ? <div className="flex flex-col gap-1.5">{buttons('large')}</div> : null}
      </div>
    </CardFrame>
  );
}
