/**
 * A media player: what is playing, the transport, the volume and the input.
 *
 * Every part appears only where the player declared it: a seek bar for one that can seek and
 * knows how long the track is, a volume for one whose volume can be set, an input for one that
 * listed its inputs. Play and pause are one button that says which it will do.
 */
import { AppIcon, IconButton, SelectField, Slider } from '@nebula-home/ui';

import { paramsOf } from '@/library/entity-control';
import { ControlBlock, type ControlProps } from '@/routes/library/entity/controls/control-block';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/**
 * Writes a length of time as a clock does.
 *
 * @param seconds - How long.
 * @returns `3:07`, or `1:02:45` past an hour.
 */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');

  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${String(minutes)}:${rest}`;
}

/**
 * Renders the media control.
 *
 * @param props - See {@link ControlProps}.
 * @returns The block.
 */
export function MediaControl(props: ControlProps) {
  const { entity, state, reportedAt, commander, disabled } = props;
  const params = paramsOf(entity, 'media_player') ?? {
    supportedSources: [],
    hasSeek: false,
    hasVolume: true,
  };
  const media = state.media_player;
  const volume = usePendingValue(media?.volume ?? 0, reportedAt);
  const position = usePendingValue(media?.mediaPositionSeconds ?? 0, reportedAt);
  const isPlaying = media?.playback === 'playing';
  const duration = media?.mediaDurationSeconds;
  const nowPlaying = [media?.mediaTitle, media?.mediaArtist].filter(Boolean).join(' · ');

  return (
    <ControlBlock
      title="Playback"
      value={
        media === undefined ? '—' : media.playback.charAt(0).toUpperCase() + media.playback.slice(1)
      }
    >
      {nowPlaying === '' ? null : (
        <p className="truncate text-title text-foreground">{nowPlaying}</p>
      )}

      {params.hasSeek && duration !== undefined && duration > 0 ? (
        <Slider
          label="Position"
          value={Math.round(position.shown)}
          min={0}
          max={Math.round(duration)}
          display={`${clock(position.shown)} / ${clock(duration)}`}
          disabled={disabled}
          onChange={position.hold}
          onCommit={(next) => {
            position.sent(next);
            commander.send('media_player', { command: 'seek', positionSeconds: next });
          }}
        />
      ) : null}

      <div className="flex items-center justify-center gap-2">
        <IconButton
          variant="raised"
          size="large"
          label="Previous"
          disabled={disabled}
          onClick={() => {
            commander.send('media_player', { command: 'previous' });
          }}
        >
          <AppIcon id="skip-back" size={16} />
        </IconButton>
        <IconButton
          variant="raised"
          size="large"
          label={isPlaying ? 'Pause' : 'Play'}
          disabled={disabled}
          onClick={() => {
            commander.send('media_player', { command: isPlaying ? 'pause' : 'play' });
          }}
        >
          <AppIcon id={isPlaying ? 'pause' : 'play'} size={16} />
        </IconButton>
        <IconButton
          variant="raised"
          size="large"
          label="Stop"
          disabled={disabled}
          onClick={() => {
            commander.send('media_player', { command: 'stop' });
          }}
        >
          <AppIcon id="square" size={15} />
        </IconButton>
        <IconButton
          variant="raised"
          size="large"
          label="Next"
          disabled={disabled}
          onClick={() => {
            commander.send('media_player', { command: 'next' });
          }}
        >
          <AppIcon id="skip-forward" size={16} />
        </IconButton>
      </div>

      {params.hasVolume ? (
        <div className="flex items-end gap-3">
          <IconButton
            variant="bare"
            label={media?.isMuted === true ? 'Unmute' : 'Mute'}
            disabled={disabled}
            onClick={() => {
              commander.send('media_player', {
                command: 'set_mute',
                isMuted: media?.isMuted !== true,
              });
            }}
          >
            <AppIcon id={media?.isMuted === true ? 'volume-x' : 'volume-2'} size={16} />
          </IconButton>
          <Slider
            label="Volume"
            className="grow"
            value={Math.round(volume.shown)}
            min={0}
            max={100}
            display={media?.isMuted === true ? 'Muted' : `${String(Math.round(volume.shown))}%`}
            disabled={disabled}
            onChange={volume.hold}
            onCommit={(next) => {
              volume.sent(next);
              commander.send('media_player', { command: 'set_volume', volume: next });
            }}
          />
        </div>
      ) : null}

      {params.supportedSources.length === 0 ? null : (
        <SelectField
          label="Input"
          size="compact"
          options={params.supportedSources.map((source) => ({ value: source, label: source }))}
          value={media?.source ?? ''}
          disabled={disabled}
          onChange={(source) => {
            commander.send('media_player', { command: 'set_source', source });
          }}
        />
      )}
    </ControlBlock>
  );
}
