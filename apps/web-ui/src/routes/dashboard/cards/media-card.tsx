/**
 * A media player: what is playing, how far through it is, and the transport.
 *
 * The strip is the cover, the player's name, the title and the artist over how far through it
 * is, and back, play or pause, forward. The square card is the same with the cover large, the
 * source as a badge, the times under the progress, and the volume.
 *
 * What the player cannot do is not drawn (`K-Capabilities`): without a cover the art is a plain
 * tile with a note; without a position there is no progress and no times; only the buttons the
 * player has are drawn. With nothing playing it says so and names the last title; Play stays, the
 * others are off.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PLAYBACK_STATES } from '@nebulahome/contracts';
import { AppIcon, cn, IconButton, Pill } from '@nebulahome/ui';

import { defineMessage, text, type Message } from '@/i18n/messages';
import { paramsOf } from '@/library/entity-control';
import { Caption, CommandNote, NoAnswer } from '@/routes/dashboard/cards/card-kit';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { canUse, sizeKey, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';

/** What a player is doing, in a word, for its badge when it names no source. */
const PLAYBACK: Readonly<Record<(typeof PLAYBACK_STATES)[number], Message>> = {
  playing: defineMessage('dashboard.cards.mediaCard.playing', 'Playing'),
  paused: defineMessage('dashboard.cards.mediaCard.paused', 'Paused'),
  stopped: defineMessage('dashboard.cards.mediaCard.stopped', 'Stopped'),
  idle: defineMessage('dashboard.cards.mediaCard.idle', 'Idle'),
  buffering: defineMessage('dashboard.cards.mediaCard.buffering', 'Loading'),
};

/** A transport command. */
type Transport = 'play' | 'pause' | 'previous' | 'next';

/**
 * Writes a length of time as a clock does.
 *
 * @param seconds - How long.
 * @returns `3:07`.
 */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));

  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * Renders a thin bar filled up to a share: how far through the track, how loud.
 *
 * @param props - The bar.
 * @param props.percent - How full, from 0 to 100.
 * @param props.fill - The fill's colour class.
 * @param props.className - Its height, and where it sits.
 * @returns The bar.
 */
function Track(props: {
  readonly percent: number;
  readonly fill: string;
  readonly className: string;
}) {
  const { percent, fill, className } = props;

  return (
    <div className={cn('shrink-0 overflow-hidden rounded-pill bg-surface-high', className)}>
      <div
        className={cn('h-full rounded-pill transition-[width] duration-300 ease-out', fill)}
        /* eslint-disable-next-line react/forbid-dom-props -- as long as the share it shows. */
        style={{ width: `${String(Math.min(100, Math.max(0, percent)))}%` }}
      />
    </div>
  );
}

/**
 * Renders a media card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function MediaCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, title, command, hidden } = model;
  const [sent, setSent] = useState<Transport>('play');
  // A picture that would not load is left for the plain tile, until the next one.
  const [brokenArt, setBrokenArt] = useState<string | null>(null);
  const isSquare = sizeKey(model.size) === '2x2';
  const params = paramsOf(entity, 'media_player');
  const player = state.media_player;
  const playback = player?.playback;
  const isPlaying = playback === 'playing' || playback === 'buffering';
  const isIdle = playback === undefined || playback === 'idle' || playback === 'stopped';
  const canSkip = params?.canSkip !== false;
  const duration = player?.mediaDurationSeconds ?? 0;
  const position = player?.mediaPositionSeconds;
  const hasProgress = !isIdle && duration > 0 && position !== undefined && !hidden.has('progress');
  const image = player?.mediaImagePath;
  const playedBy = [player?.mediaArtist, player?.mediaAlbum].filter(Boolean).join(' · ');
  const heading = isIdle
    ? t('dashboard.cards.mediaCard.nothingPlaying', 'Nothing playing')
    : (player?.mediaTitle ?? player?.source ?? '');
  const lastPlayed = [player?.mediaTitle, player?.mediaArtist].filter(Boolean).join(' · ');
  const byline = isIdle
    ? lastPlayed === ''
      ? ''
      : t('dashboard.cards.mediaCard.lastPlayed', 'Last played {{what}}', { what: lastPlayed })
    : playedBy;
  const sending = {
    play: t('dashboard.cards.mediaCard.starting', 'Starting…'),
    pause: t('dashboard.cards.mediaCard.pausing', 'Pausing…'),
    previous: t('dashboard.cards.mediaCard.skipping', 'Skipping…'),
    next: t('dashboard.cards.mediaCard.skipping', 'Skipping…'),
  }[sent];

  /**
   * Sends one transport command.
   *
   * @param next - Which.
   */
  const send = (next: Transport): void => {
    setSent(next);
    command.send('media_player', { command: next });
  };

  /**
   * The cover of what is playing, or a plain tile with a note when there is none.
   *
   * @param box - Its size and corners.
   * @param note - How large the note is.
   * @returns The art.
   */
  const art = (box: string, note: number) =>
    image === undefined || image === brokenArt ? (
      <span
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center border border-border bg-surface-raised text-foreground-subtle',
          box,
        )}
      >
        <svg
          width={note}
          height={note}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </span>
    ) : (
      <img
        src={image}
        alt=""
        className={cn('shrink-0 object-cover', box)}
        onError={() => {
          setBrokenArt(image);
        }}
      />
    );

  /**
   * The transport: back and forward when the player skips, play or pause between them, lit while
   * something plays.
   *
   * @param large - The square card's 34 and 44 px, or the strip's 32 and 40.
   * @returns The buttons, or nothing for someone who may only look.
   */
  const transport = (large: boolean) => {
    if (!model.canControl) {
      return null;
    }

    const disabled = !canUse(model, 'media_player');
    const side = cn('text-foreground disabled:opacity-40', large ? 'size-8.5' : 'size-8');
    const glyph = large ? 17 : 16;

    return (
      <div className={cn('flex items-center', large ? 'gap-2' : 'gap-1.5')}>
        {canSkip ? (
          <IconButton
            variant="raised"
            size={null}
            label={t('dashboard.cards.mediaCard.previous', 'Previous')}
            className={side}
            disabled={disabled || isIdle}
            onClick={() => {
              send('previous');
            }}
          >
            <AppIcon id="skip-back" size={glyph} />
          </IconButton>
        ) : null}
        <IconButton
          variant={isIdle ? 'raised' : 'primary'}
          size={null}
          label={
            isPlaying
              ? t('dashboard.cards.mediaCard.pause', 'Pause')
              : t('dashboard.cards.mediaCard.play', 'Play')
          }
          className={cn(
            'transition-colors duration-200 disabled:opacity-40',
            isIdle && 'text-foreground',
            large ? 'size-11' : 'size-10',
          )}
          disabled={disabled}
          onClick={() => {
            send(isPlaying ? 'pause' : 'play');
          }}
        >
          <AppIcon id={isPlaying ? 'pause' : 'play'} size={18} />
        </IconButton>
        {canSkip ? (
          <IconButton
            variant="raised"
            size={null}
            label={t('dashboard.cards.mediaCard.next', 'Next')}
            className={side}
            disabled={disabled || isIdle}
            onClick={() => {
              send('next');
            }}
          >
            <AppIcon id="skip-forward" size={glyph} />
          </IconButton>
        ) : null}
      </div>
    );
  };

  const offline = t('dashboard.cards.kit.offline', 'Offline');
  const viewOnly = (
    <span
      className="inline-flex shrink-0 text-foreground-subtle"
      title={t('dashboard.cards.kit.viewOnly', 'View only')}
    >
      <AppIcon id="eye" size={14} />
    </span>
  );
  const headingClass = model.isOffline ? 'text-foreground-subtle' : 'text-foreground';
  const percent = hasProgress ? (position / duration) * 100 : 0;

  if (!isSquare) {
    return (
      <CardFrame label={title}>
        <div className="flex min-h-0 grow items-center gap-4">
          {art('size-17 rounded-field', 22)}
          <div className="flex min-w-0 grow flex-col gap-[3px]">
            <Caption>{model.isOffline ? `${title} · ${offline}` : title}</Caption>
            <span className={cn('truncate text-title font-medium', headingClass)}>{heading}</span>
            {command.hasFailed ? (
              <NoAnswer command={command} />
            ) : (
              <>
                <CommandNote command={command} sending={sending}>
                  {byline === '' ? null : (
                    <Caption className="text-foreground-muted">{byline}</Caption>
                  )}
                </CommandNote>
                {hasProgress ? (
                  <Track percent={percent} fill="bg-violet" className="mt-1.5 h-[3px]" />
                ) : null}
              </>
            )}
          </div>
          {model.canControl ? transport(false) : viewOnly}
        </div>
      </CardFrame>
    );
  }

  const hasVolume = params?.hasVolume !== false && player !== undefined && !hidden.has('volume');
  const isLoud = player !== undefined && !player.isMuted;
  const badge = model.isOffline ? (
    <Pill className="bg-surface-raised text-foreground-muted *:bg-current">{offline}</Pill>
  ) : playback === undefined ? null : (
    <Pill
      className={cn(
        '*:bg-current',
        isPlaying ? 'bg-success/8 text-success' : 'bg-surface-raised text-foreground-muted',
      )}
    >
      {(isIdle ? null : player?.source) ?? text(PLAYBACK[playback])}
    </Pill>
  );

  return (
    <CardFrame label={title}>
      <div className="flex min-h-0 grow gap-4.5">
        {art('size-46 rounded-tile', 40)}
        <div className="flex min-w-0 grow flex-col">
          <div className="flex min-w-0 items-center justify-between gap-2.5">
            <Caption className="inline-flex items-center gap-1.25 text-foreground-subtle">
              <AppIcon id="volume-2" size={12} />
              {title}
            </Caption>
            <span className="flex shrink-0 items-center gap-2">
              {badge}
              {model.canControl ? null : viewOnly}
            </span>
          </div>
          <span className={cn('mt-3.5 truncate text-[19px] font-medium', headingClass)}>
            {heading}
          </span>
          <CommandNote command={command} sending={sending}>
            {byline === '' ? null : (
              <span className="truncate text-ui-sm text-foreground-muted">{byline}</span>
            )}
          </CommandNote>
          {hasProgress ? (
            <div className="mt-auto flex flex-col gap-1.5">
              <Track percent={percent} fill="bg-violet" className="h-1" />
              <div className="flex min-w-0 items-center justify-between gap-2.5">
                <Caption>{clock(position)}</Caption>
                <Caption>{clock(duration)}</Caption>
              </div>
            </div>
          ) : null}
          {command.hasFailed ? (
            <div className={hasProgress ? 'mt-2.5' : 'mt-auto'}>
              <NoAnswer command={command} />
            </div>
          ) : (
            <div
              className={cn(
                'flex items-center justify-between gap-2.5',
                hasProgress ? 'mt-2.5' : 'mt-auto',
              )}
            >
              {transport(true) ?? <span />}
              {hasVolume ? (
                <div className="flex w-30 items-center gap-2 text-foreground-subtle">
                  <AppIcon id={isLoud ? 'volume-2' : 'volume-x'} size={14} />
                  <Track
                    percent={isLoud ? player.volume : 0}
                    fill="bg-foreground"
                    className="h-1 grow"
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </CardFrame>
  );
}
