/**
 * A media player: what is playing, and the transport.
 *
 * The square card is the player as a person pictures one - the art on the left, the title and the
 * artist, how far through the track it is, and back, play or pause, and forward. The strip keeps
 * the title and the one button that matters. The art is the player's glyph on a tinted square:
 * the contract carries no cover image, and a picture made up here would be a picture of nothing.
 */
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, IconButton } from '@nebulahome/ui';

import { paramsOf } from '@/library/entity-control';
import { CardFrame } from '@/routes/dashboard/cards/card-parts';
import { sizeKey, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import { useEntityCommand } from '@/routes/library/entity/use-entity-command';

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
 * Renders a media card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function MediaCard(props: { readonly model: EntityCardModel }) {
  const { t } = useTranslation();

  const { model } = props;
  const { entity, state, title, subtitle } = model;
  const commander = useEntityCommand(entity.entityId);
  const media = state.media_player;
  const isPlaying = media?.playback === 'playing';
  const disabled = !model.canControl || commander.busy.has('media_player');
  const nowPlaying =
    media?.mediaTitle ??
    (media === undefined
      ? t('dashboard.cards.mediaCard.nothingPlaying', 'Nothing playing')
      : `${media.playback.charAt(0).toUpperCase()}${media.playback.slice(1)}`);
  const artist = media?.mediaArtist;
  const source = [title, subtitle].filter(Boolean).join(' · ');

  /**
   * Sends one transport command.
   *
   * @param command - Which.
   */
  const send = (command: string): void => {
    commander.send('media_player', { command });
  };

  const art = (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-tile border border-tag-violet/25',
        'bg-gradient-to-br from-tag-violet/30 via-tag-blue/15 to-tag-teal/15 text-foreground-muted',
      )}
    >
      <AppIcon id="play" size={24} />
    </span>
  );
  const playPause = (
    <IconButton
      variant="raised"
      size="large"
      label={
        isPlaying
          ? t('dashboard.cards.mediaCard.pauseTitle', 'Pause {{title}}', { title })
          : t('dashboard.cards.mediaCard.playTitle', 'Play {{title}}', { title })
      }
      className="rounded-full"
      disabled={disabled}
      onClick={() => {
        send(isPlaying ? 'pause' : 'play');
      }}
    >
      <AppIcon id={isPlaying ? 'pause' : 'play'} size={16} />
    </IconButton>
  );

  if (sizeKey(model.size) === '2x1') {
    return (
      <CardFrame label={title}>
        <div className="flex h-full min-w-0 items-center gap-3">
          <span className="flex size-15 shrink-0">{art}</span>
          <div className="flex min-w-0 grow flex-col gap-0.5">
            <span className="truncate text-title font-medium">{nowPlaying}</span>
            <span className="truncate text-caption text-foreground-subtle">{artist ?? source}</span>
          </div>
          {playPause}
        </div>
      </CardFrame>
    );
  }

  const duration = media?.mediaDurationSeconds;
  const position = media?.mediaPositionSeconds ?? 0;
  const hasSkip = paramsOf(entity, 'media_player') !== null;

  return (
    <CardFrame label={title} className="flex-row gap-4">
      <span className="flex aspect-square h-full max-w-[45%] shrink-0">{art}</span>
      <div className="flex min-w-0 grow flex-col">
        <span className="truncate text-subhead font-medium tracking-tight">{nowPlaying}</span>
        {artist === undefined ? null : (
          <span className="truncate text-ui text-foreground-muted">{artist}</span>
        )}
        <span className="truncate text-caption text-foreground-subtle">{source}</span>
        <div className="grow" />
        {duration === undefined || duration <= 0 ? null : (
          <div className="flex items-center gap-2 font-mono text-label text-foreground-subtle tabular">
            <span>{clock(position)}</span>
            <div className="h-1.5 grow overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full rounded-full bg-success"
                /* eslint-disable-next-line react/forbid-dom-props -- the bar is as long as the track has played,
                a number no class can carry (RULES.md 15.3). */
                style={{ width: `${String(Math.min(100, (position / duration) * 100))}%` }}
              />
            </div>
            <span>{clock(duration)}</span>
          </div>
        )}
        <div className="mt-2.5 flex items-center gap-1.5">
          {hasSkip ? (
            <IconButton
              label={t('dashboard.cards.mediaCard.previousOnTitle', 'Previous on {{title}}', {
                title,
              })}
              disabled={disabled}
              onClick={() => {
                send('previous');
              }}
            >
              <AppIcon id="skip-back" size={16} />
            </IconButton>
          ) : null}
          {playPause}
          {hasSkip ? (
            <IconButton
              label={t('dashboard.cards.mediaCard.nextOnTitle', 'Next on {{title}}', { title })}
              disabled={disabled}
              onClick={() => {
                send('next');
              }}
            >
              <AppIcon id="skip-forward" size={16} />
            </IconButton>
          ) : null}
          <span className="grow" />
          {media === undefined ? null : (
            <span className="flex items-center gap-1 text-caption text-foreground-subtle tabular">
              <AppIcon id={media.isMuted ? 'volume-x' : 'volume-2'} size={14} />
              {media.isMuted
                ? t('dashboard.cards.mediaCard.muted', 'Muted')
                : `${String(Math.round(media.volume))}%`}
            </span>
          )}
        </div>
      </div>
    </CardFrame>
  );
}
