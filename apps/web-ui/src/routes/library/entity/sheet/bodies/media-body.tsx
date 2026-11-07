/**
 * A media player, as the canvas draws it (`N-Entity-Modal-Media`, `N-Entity-Media-More`). Every
 * control is a feature, so each is drawn only when the player has it: the source as a pill, power
 * beside it; the artwork - a record turning behind it while it plays, rings for live radio, the
 * device's own picture when there is no artwork; what is playing; the progress, or LIVE; the
 * transport with shuffle and repeat either side; the volume as a line, or as steps; sound modes.
 * Switched off, only the power is left.
 *
 * While it plays, the artwork glows, three bars dance beside the title and the progress moves on
 * by itself between reports, as the music does.
 */
import { useContext, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import { hasCapability, paramsOf } from '@/library/entity-control';
import { ListViewContext, OptionList } from '@/routes/library/entity/sheet/parts/option-list';
import { BlockHead, useSinceLine } from '@/routes/library/entity/sheet/parts/sheet-controls';
import { SendingSpinner } from '@/routes/library/entity/sheet/parts/sheet-parts';
import type { SheetBodyProps } from '@/routes/library/entity/sheet/sheet-types';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/**
 * Writes seconds as a clock: 4:03.
 *
 * @param seconds - The seconds.
 * @returns The time.
 */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));

  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`;
}

/** What a thin line with a knob needs. */
type LineSliderProps = {
  readonly label: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly onCommit: (value: number) => void;
  readonly disabled: boolean;
};

/**
 * The thin line a player's volume and position are set on.
 *
 * @param props - See {@link LineSliderProps}.
 * @returns The line.
 */
function LineSlider(props: LineSliderProps) {
  const { label, value, onChange, onCommit, disabled } = props;

  return (
    <div className="entity-slider group relative h-4 grow">
      <div className="absolute inset-x-0 top-1.5 h-1 overflow-hidden rounded-pill bg-foreground/14">
        <div
          className="entity-track h-full rounded-pill bg-foreground"
          // eslint-disable-next-line react/forbid-dom-props -- the line is lit to the value
          style={{ width: `${String(value)}%` }}
        />
      </div>
      <span
        className="entity-track absolute top-0.5 size-3 rounded-full bg-knob transition-transform group-hover:scale-125"
        // eslint-disable-next-line react/forbid-dom-props -- the knob sits at the value
        style={{ left: `calc(${String(value)}% - 6px)` }}
      />
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          onChange(Number(event.target.value));
        }}
        onPointerUp={(event) => {
          onCommit(Number(event.currentTarget.value));
        }}
        className="absolute inset-0 m-0 size-full cursor-pointer opacity-0"
      />
    </div>
  );
}

/**
 * Three bars dancing while music plays.
 *
 * @returns The bars.
 */
function PlayingBars() {
  return (
    <span aria-hidden="true" className="flex h-3.5 items-end gap-0.5">
      {[0, 1, 2].map((bar) => (
        <span
          key={bar}
          className="entity-eq h-full w-0.75 rounded-pill bg-media"
          // eslint-disable-next-line react/forbid-dom-props -- each bar out of step with the others
          style={{ animationDelay: `${String(-bar * 0.32)}s` }}
        />
      ))}
    </span>
  );
}

/**
 * The time now, ticking every second while something plays: the progress moves on between the
 * player's reports.
 *
 * @param isTicking - Whether to tick.
 * @returns The time, in milliseconds since the epoch.
 */
function usePlayClock(isTicking: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  // A timer is something outside React to synchronise with (RULES.md 15.2).
  useEffect(() => {
    if (!isTicking) {
      return undefined;
    }

    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return (): void => {
      clearInterval(timer);
    };
  }, [isTicking]);

  return now;
}

/**
 * The body of a media player.
 *
 * @param props - See {@link SheetBodyProps}.
 * @returns The body.
 */
export function MediaBody(props: SheetBodyProps) {
  const { t } = useTranslation();
  const { entity, state, commander, disabled, reportedAt, history } = props;
  const since = useSinceLine(entity, history);
  const openList = useContext(ListViewContext);
  const params = paramsOf(entity, 'media_player');
  const volume = usePendingValue(
    state.media_player?.volume ?? 0,
    reportedAt,
    commander.busy.has('media_player'),
  );
  const position = usePendingValue(
    state.media_player?.mediaPositionSeconds ?? 0,
    reportedAt,
    commander.busy.has('media_player'),
  );
  const player = state.media_player;
  // A picture that would not load is left for the drawn artwork, until the next one.
  const [brokenArt, setBrokenArt] = useState<string | null>(null);
  const ticked = usePlayClock(player?.playback === 'playing');

  if (player === undefined || params === null) {
    return null;
  }

  const reportedPosition = player.mediaPositionSeconds ?? 0;
  // Between reports the music goes on: the position moves on with the clock while it plays,
  // unless the knob is held or was just set.
  const playedTo =
    player.playback === 'playing' &&
    reportedAt !== null &&
    position.shown === reportedPosition &&
    player.mediaDurationSeconds !== undefined
      ? Math.min(
          player.mediaDurationSeconds,
          reportedPosition + Math.max(0, ticked - reportedAt) / 1000,
        )
      : position.shown;
  const hasPower = hasCapability(entity, 'on_off');

  const isOn = state.on_off?.isOn !== false;
  const isPlaying = player.playback === 'playing';
  const duration = player.mediaDurationSeconds;
  const isLive = duration === undefined && player.mediaTitle !== undefined;
  const isTv = entity.deviceClass === 'tv';
  const sources = params.supportedSources;
  const hasSource = sources.length > 0 || player.source !== undefined;
  const isCompact = !hasSource && !hasPower && !params.hasSeek;
  const isSending = commander.busy.has('media_player') || commander.busy.has('on_off');
  const sourceIcon: UiIconId = /hdmi/iu.test(player.source ?? '')
    ? 'hdmi-port'
    : /radio/iu.test(player.source ?? '')
      ? 'radio'
      : 'speaker';

  /**
   * Sends one of the player's commands.
   *
   * @param command - The command, with what it takes.
   */
  const send = (command: Record<string, string | number | boolean>): void => {
    commander.send('media_player', command);
  };

  /**
   * Picks a source.
   *
   * @param source - The source.
   */
  const pickSource = (source: string): void => {
    send({ command: 'set_source', source });
  };

  /**
   * Switches the player on or off.
   *
   * @param next - Whether it should be on.
   */
  const power = (next: boolean): void => {
    commander.send('on_off', { command: next ? 'turn_on' : 'turn_off' });
  };

  if (hasPower && !isOn) {
    return (
      <div className="flex grow flex-col justify-center gap-4.5">
        <div className="flex items-center justify-between">
          <span className="text-ui-sm text-foreground-subtle">
            {player.source === undefined
              ? ''
              : t('entity.sheet.media.lastSource', 'Last source: {{source}}', {
                  source: player.source,
                })}
          </span>
          <button
            type="button"
            aria-label={t('entity.sheet.media.turnOn', 'Turn on')}
            disabled={disabled}
            onClick={() => {
              power(true);
            }}
            className="flex size-8.5 cursor-pointer items-center justify-center rounded-full border border-foreground-muted/45 bg-foreground-muted/10 p-0 text-foreground-muted"
          >
            <AppIcon id="power" size={15} />
          </button>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            power(true);
          }}
          className="flex cursor-pointer flex-col items-center gap-3.5 pt-4.5 pb-2"
        >
          <span className="flex size-30 items-center justify-center rounded-full border border-border-strong bg-surface-raised text-foreground-subtle">
            <AppIcon id="power" size={40} />
          </span>
          <span className="flex flex-col items-center gap-1">
            <span className="text-[24px] font-medium">{t('common.off', 'Off')}</span>
            <span className="text-ui-sm text-foreground-subtle">
              {t('entity.sheet.media.tapToTurnOn', '{{since}} · tap to turn on', { since })}
            </span>
          </span>
        </button>
      </div>
    );
  }

  /**
   * The artwork of what is playing, or a picture in its place.
   *
   * @param size - Large in the middle, small beside the title.
   * @returns The artwork.
   */
  const art = (size: 'large' | 'small'): ReactNode =>
    player.mediaImagePath === undefined || player.mediaImagePath === brokenArt ? (
      <span
        aria-hidden="true"
        className={cn(
          'relative block shrink-0 overflow-hidden rounded-inner bg-[radial-gradient(circle_at_30%_30%,#ffb35c_0%,#ff5c9d_35%,#5b3fd1_70%,#1b1f35_100%)]',
          size === 'large'
            ? 'size-47 shadow-[0_30px_70px_-20px_color-mix(in_oklab,var(--color-media)_60%,transparent),0_0_0_1px_rgb(255_255_255/0.08)]'
            : 'size-24 shadow-[0_18px_40px_-14px_rgb(91_63_209/0.7)]',
        )}
      >
        <span className="absolute inset-0 bg-[repeating-radial-gradient(circle_at_70%_75%,rgb(255_255_255/0.06)_0_2px,transparent_2px_8px)]" />
        <span className="absolute inset-0 bg-linear-135 from-white/16 to-white/0 to-45%" />
      </span>
    ) : (
      <img
        src={player.mediaImagePath}
        alt=""
        onError={() => {
          setBrokenArt(player.mediaImagePath ?? null);
        }}
        className={cn(
          'shrink-0 rounded-inner object-cover',
          size === 'large' ? 'size-47' : 'size-24',
        )}
      />
    );

  const transport = (
    <div className="flex items-center justify-between">
      {params.hasShuffle ? (
        <button
          type="button"
          aria-label={t('entity.sheet.media.shuffle', 'Shuffle')}
          aria-pressed={player.isShuffled === true}
          disabled={disabled}
          onClick={() => {
            send({ command: 'set_shuffle', isShuffled: player.isShuffled !== true });
          }}
          className={cn(
            'flex size-10 cursor-pointer items-center justify-center rounded-tile border p-0',
            player.isShuffled === true
              ? 'border-media/45 bg-media/12 text-media'
              : 'border-border-strong text-foreground-muted',
          )}
        >
          <AppIcon id="shuffle" size={17} />
        </button>
      ) : (
        <span className="w-10" />
      )}
      <div className="flex items-center justify-center gap-5.5">
        {params.canSkip && !isCompact ? (
          <button
            type="button"
            aria-label={t('entity.sheet.media.previous', 'Previous')}
            disabled={disabled}
            onClick={() => {
              send({ command: 'previous' });
            }}
            className="press-scale flex size-12 cursor-pointer items-center justify-center rounded-full p-0 text-foreground transition-colors duration-200 hover:bg-surface-raised"
          >
            <AppIcon id="skip-back" size={22} />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={
            isPlaying
              ? isLive && params.canStop
                ? t('entity.sheet.media.stop', 'Stop')
                : t('entity.sheet.media.pause', 'Pause')
              : t('entity.sheet.media.play', 'Play')
          }
          disabled={disabled}
          onClick={() => {
            send({ command: isPlaying ? (isLive && params.canStop ? 'stop' : 'pause') : 'play' });
          }}
          className="press-scale flex size-16 cursor-pointer items-center justify-center rounded-full bg-foreground p-0 text-canvas shadow-[0_0_0_6px_color-mix(in_oklab,var(--color-foreground)_6%,transparent),0_12px_40px_-8px_color-mix(in_oklab,var(--color-media)_60%,transparent)]"
        >
          {isSending ? (
            <span
              role="status"
              aria-label={t('entity.sheet.sending', 'Sending')}
              className="entity-spin flex"
            >
              <AppIcon id="loader-circle" size={24} />
            </span>
          ) : (
            <AppIcon
              id={isPlaying ? (isLive && params.canStop ? 'square' : 'pause') : 'play'}
              size={24}
            />
          )}
        </button>
        {params.canSkip && !isCompact ? (
          <button
            type="button"
            aria-label={t('entity.sheet.media.next', 'Next')}
            disabled={disabled}
            onClick={() => {
              send({ command: 'next' });
            }}
            className="press-scale flex size-12 cursor-pointer items-center justify-center rounded-full p-0 text-foreground transition-colors duration-200 hover:bg-surface-raised"
          >
            <AppIcon id="skip-forward" size={22} />
          </button>
        ) : null}
      </div>
      {params.hasRepeat ? (
        <button
          type="button"
          aria-label={t('entity.sheet.media.repeat', 'Repeat')}
          aria-pressed={player.repeat !== undefined && player.repeat !== 'off'}
          disabled={disabled}
          onClick={() => {
            send({
              command: 'set_repeat',
              repeat: player.repeat === 'all' ? 'one' : player.repeat === 'one' ? 'off' : 'all',
            });
          }}
          className={cn(
            'flex size-10 cursor-pointer items-center justify-center rounded-tile border p-0',
            player.repeat !== undefined && player.repeat !== 'off'
              ? 'border-media/45 bg-media/12 text-media'
              : 'border-border-strong text-foreground-muted',
          )}
        >
          <AppIcon id={player.repeat === 'one' ? 'repeat-1' : 'repeat'} size={17} />
        </button>
      ) : (
        <span className="w-10" />
      )}
    </div>
  );

  const volumeRow =
    params.hasVolumeStep && !params.hasVolume ? (
      <div className="flex items-center gap-2.5">
        {(
          [
            ['volume_down', 'volume-1', t('entity.sheet.media.volumeDown', 'Volume down')],
            ['mute', 'volume-x', t('entity.sheet.media.mute', 'Mute')],
            ['volume_up', 'volume-2', t('entity.sheet.media.volumeUp', 'Volume up')],
          ] as const
        ).map(([command, icon, label]) => (
          <button
            key={command}
            type="button"
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={() => {
              send(
                command === 'mute'
                  ? { command: 'set_mute', isMuted: !player.isMuted }
                  : { command },
              );
            }}
            className={cn(
              'flex size-12 cursor-pointer items-center justify-center rounded-full border p-0',
              command === 'mute' && player.isMuted
                ? 'border-media/45 bg-media/12 text-media'
                : 'border-border-strong bg-surface-raised text-foreground',
            )}
          >
            <AppIcon id={icon} size={18} />
          </button>
        ))}
      </div>
    ) : params.hasVolume ? (
      <div className="flex items-center gap-3 text-foreground-muted">
        <button
          type="button"
          aria-label={t('entity.sheet.media.mute', 'Mute')}
          aria-pressed={player.isMuted}
          disabled={disabled}
          onClick={() => {
            send({ command: 'set_mute', isMuted: !player.isMuted });
          }}
          className="flex cursor-pointer"
        >
          <AppIcon id={player.isMuted ? 'volume-x' : 'volume-1'} size={16} />
        </button>
        <LineSlider
          label={t('entity.sheet.media.volume', 'Volume')}
          value={Math.round(volume.shown)}
          disabled={disabled}
          onChange={volume.hold}
          onCommit={(next) => {
            volume.sent(next);
            send({ command: 'set_volume', volume: next });
          }}
        />
        <span className="w-8 text-right font-mono text-mono-caption">
          {t('entity.sheet.percent', '{{value}}%', { value: Math.round(volume.shown) })}
        </span>
      </div>
    ) : null;

  if (isCompact) {
    return (
      <div className="flex grow flex-col justify-center gap-4.5">
        <div className="flex items-center gap-4">
          {art('small')}
          <div className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-2 text-caption text-foreground-subtle">
              {isPlaying
                ? t('entity.sheet.media.playing', 'Playing')
                : t('entity.sheet.media.paused', 'Paused')}
              {isSending ? <SendingSpinner tone="media" size={14} /> : null}
            </span>
            <span className="truncate text-[19px] font-medium">
              {player.mediaTitle ?? entity.name}
            </span>
            {player.mediaArtist === undefined ? null : (
              <span className="truncate text-ui-sm text-foreground-muted">
                {player.mediaArtist}
              </span>
            )}
          </div>
        </div>
        {transport}
        {volumeRow}
        <span className="text-ui-sm leading-[1.45] text-foreground-subtle">
          {t(
            'entity.sheet.media.onlyPlay',
            'Only play, pause and volume: no source, power or progress.',
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="flex grow flex-col justify-center gap-4.5">
      <div className="flex items-center justify-between gap-2">
        {hasSource ? (
          <button
            type="button"
            aria-haspopup="dialog"
            disabled={disabled || sources.length === 0}
            onClick={() => {
              openList({
                title: t('entity.sheet.media.source', 'Source'),
                options: sources.map((value) => ({ value })),
                value: player.source ?? null,
                tone: 'media',
                onPick: pickSource,
              });
            }}
            className="inline-flex h-8.5 cursor-pointer items-center gap-2 rounded-pill border border-border-strong bg-surface-raised px-3 text-ui-sm font-medium text-foreground"
          >
            <AppIcon id={sourceIcon} size={15} />
            {player.source ?? t('entity.sheet.media.noSource', 'No source')}
            {sources.length > 4 ? (
              <span className="ml-0.5 font-mono text-[10px] text-foreground-subtle">
                {sources.length}
              </span>
            ) : null}
            <AppIcon id="chevron-down" size={14} />
          </button>
        ) : (
          <span />
        )}
        {hasPower ? (
          <button
            type="button"
            role="switch"
            aria-checked
            aria-label={t('entity.sheet.media.power', 'Power')}
            title={t('entity.sheet.media.power', 'Power')}
            disabled={disabled}
            onClick={() => {
              power(false);
            }}
            className="flex size-8.5 cursor-pointer items-center justify-center rounded-full border border-success/45 bg-success/12 p-0 text-success"
          >
            <AppIcon id="power" size={15} />
          </button>
        ) : null}
      </div>

      {isTv && player.mediaImagePath === undefined && player.mediaTitle === undefined ? (
        <div className="relative h-42.5 overflow-hidden rounded-card border border-border-strong bg-[radial-gradient(80%_90%_at_30%_20%,rgb(167_139_250/0.35),transparent_60%),linear-gradient(160deg,#1b1f3a,#0e1020)]">
          <div className="absolute bottom-4 left-4.5 flex flex-col gap-1">
            <span className="text-[22px] font-medium tracking-[-0.02em]">
              {player.source ?? entity.name}
            </span>
            <span className="text-caption text-foreground-muted">
              {t('entity.sheet.media.noPicture', '{{since}} · no picture from the source', {
                since,
              })}
            </span>
          </div>
          <span className="absolute top-3.5 right-4 flex text-foreground-subtle">
            <AppIcon id="tv" size={26} />
          </span>
        </div>
      ) : isLive ? (
        <div className="relative flex size-47 items-center justify-center self-center overflow-hidden rounded-inner bg-linear-145 from-[#3a1d5c] to-danger text-white shadow-[0_30px_70px_-20px_color-mix(in_oklab,var(--color-danger)_55%,transparent)]">
          {[90, 140, 190].map((ring, index) => (
            <span
              key={ring}
              aria-hidden="true"
              className="entity-breathe absolute rounded-full border-[1.5px] border-white/30"
              // eslint-disable-next-line react/forbid-dom-props -- three rings, each further out and later
              style={{ width: ring, height: ring, animationDelay: `${String(index * 0.6)}s` }}
            />
          ))}
          <AppIcon id="radio" size={44} />
        </div>
      ) : (
        <div className="relative self-center">
          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-4 rounded-[28px] bg-media/40 blur-3xl transition-opacity duration-700',
              isPlaying ? 'entity-breathe' : 'opacity-0',
            )}
          />
          <span
            key={player.mediaTitle}
            className={cn(
              'relative block animate-enter transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]',
              !isPlaying && 'scale-95',
            )}
          >
            {art('large')}
          </span>
        </div>
      )}

      {player.mediaTitle === undefined ? null : (
        <div
          key={player.mediaTitle}
          className="entity-tick flex flex-col items-center gap-1 text-center"
        >
          <span className="relative flex items-center gap-2 text-[20px] font-medium tracking-[-0.01em]">
            {/* Beside the title, not in its line, so the title stays centred over the artist. */}
            {isPlaying ? (
              <span className="absolute top-1/2 right-full mr-2.5 flex -translate-y-1/2">
                <PlayingBars />
              </span>
            ) : null}
            {player.mediaTitle}
          </span>
          <span className="text-ui-sm text-foreground-muted">
            {isLive
              ? t('entity.sheet.media.liveRadio', 'Live radio')
              : [player.mediaArtist, player.mediaAlbum].filter(Boolean).join(' · ')}
          </span>
        </div>
      )}

      {isLive ? (
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-6.5 items-center gap-1.75 rounded-pill border border-danger/35 bg-danger/12 px-2.5 text-[11px] font-semibold tracking-[0.08em] text-danger">
            <span className="entity-blink size-1.75 rounded-full bg-danger" />
            {t('entity.sheet.media.live', 'LIVE')}
          </span>
          <span
            aria-hidden="true"
            className="h-1 grow rounded-pill bg-linear-to-r from-danger/8 via-danger/55 to-danger/8"
          />
        </div>
      ) : params.hasSeek && duration !== undefined ? (
        <div className="flex flex-col gap-1.5">
          <LineSlider
            label={t('entity.sheet.media.position', 'Position')}
            value={Math.round((playedTo / Math.max(1, duration)) * 100)}
            disabled={disabled}
            onChange={(next) => {
              position.hold((next / 100) * duration);
            }}
            onCommit={(next) => {
              const seconds = Math.round((next / 100) * duration);

              position.sent(seconds);
              send({ command: 'seek', positionSeconds: seconds });
            }}
          />
          <div className="flex justify-between font-mono text-[10px] text-foreground-subtle">
            <span>{clock(playedTo)}</span>
            <span>{clock(duration)}</span>
          </div>
        </div>
      ) : null}

      {transport}
      {volumeRow}

      {params.soundModes.length === 0 ? null : (
        <div className="flex flex-col gap-2.5">
          <BlockHead
            title={t('entity.sheet.media.soundMode', 'Sound mode')}
            aside={t('entity.sheet.media.fromThePlayer', '{{count}} from the player', {
              count: params.soundModes.length,
            })}
          />
          <OptionList
            title={t('entity.sheet.media.soundMode', 'Sound mode')}
            options={params.soundModes.map((value) => ({ value }))}
            value={player.soundMode ?? null}
            tone="media"
            hasIcons={false}
            disabled={disabled}
            onPick={(soundMode) => {
              send({ command: 'set_sound_mode', soundMode });
            }}
          />
        </div>
      )}
    </div>
  );
}
