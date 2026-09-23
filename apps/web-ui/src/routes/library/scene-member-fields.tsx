/**
 * The controls for one scene member's target state.
 *
 * Each capability present in `targetState` gets its own control: on/off and lock as a segmented
 * choice, levels and colour as a slider with the figure beside it, the rest as ordinary fields.
 * There is no shared state editor elsewhere in the library; these fields are the place.
 */
import { THERMOSTAT_MODES, type CapabilityState } from '@nebula-home/contracts';
import { Segmented, SelectField, Slider, TextField } from '@nebula-home/ui';

/** Playback options the editor offers. */
const PLAYBACK_OPTIONS = [
  { value: 'playing' as const, label: 'Playing' },
  { value: 'paused' as const, label: 'Paused' },
  { value: 'stopped' as const, label: 'Stopped' },
];

/** Thermostat mode options. */
const MODE_OPTIONS = THERMOSTAT_MODES.map((mode) => ({
  value: mode,
  label: mode.charAt(0).toUpperCase() + mode.slice(1).replaceAll('_', ' '),
}));

/** What the member fields need. */
export type SceneMemberFieldsProps = {
  /** The target state being edited. */
  readonly targetState: CapabilityState;

  /** Called with the next target state. */
  readonly onChange: (targetState: CapabilityState) => void;
};

/**
 * Replaces one capability's entry inside the target state.
 *
 * @param targetState - The whole state.
 * @param capability - Which entry.
 * @param next - Its new value.
 * @returns The updated state.
 */
function withCapability<TKey extends keyof CapabilityState>(
  targetState: CapabilityState,
  capability: TKey,
  next: NonNullable<CapabilityState[TKey]>,
): CapabilityState {
  return { ...targetState, [capability]: next };
}

/**
 * Narrows a dropdown value to a thermostat mode.
 *
 * @param value - What the dropdown reported.
 * @returns The mode, or heat when the value is not one.
 */
function thermostatMode(value: string): (typeof THERMOSTAT_MODES)[number] {
  const match = THERMOSTAT_MODES.find((mode) => mode === value);

  return match ?? 'heat';
}

/**
 * Renders one control per capability in the member's target state.
 *
 * @param props - See {@link SceneMemberFieldsProps}.
 * @returns The fields.
 */
export function SceneMemberFields(props: SceneMemberFieldsProps) {
  const { targetState, onChange } = props;
  const power = targetState.on_off;
  const level = targetState.level;
  const colour = targetState.color_hs;
  const colourTemp = targetState.color_temp;
  const cover = targetState.cover;
  const lock = targetState.lock;
  const thermostat = targetState.thermostat;
  const media = targetState.media_player;
  const playback =
    media?.playback === 'playing' || media?.playback === 'paused' || media?.playback === 'stopped'
      ? media.playback
      : 'paused';

  return (
    <div className="flex flex-col gap-3.5">
      {power === undefined ? null : (
        <Segmented
          label="Power"
          size="compact"
          options={[
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
          value={power.isOn ? 'on' : 'off'}
          onChange={(value) => {
            onChange(withCapability(targetState, 'on_off', { isOn: value === 'on' }));
          }}
        />
      )}

      {level === undefined ? null : (
        <Slider
          label="Level"
          min={0}
          max={100}
          value={level.level}
          display={`${String(Math.round(level.level))}%`}
          onChange={(next) => {
            onChange(withCapability(targetState, 'level', { level: next }));
          }}
        />
      )}

      {colour === undefined ? null : (
        <>
          <Slider
            label="Hue"
            min={0}
            max={360}
            value={colour.hue}
            display={`${String(Math.round(colour.hue))}°`}
            onChange={(hue) => {
              onChange(
                withCapability(targetState, 'color_hs', { hue, saturation: colour.saturation }),
              );
            }}
          />
          <Slider
            label="Saturation"
            min={0}
            max={100}
            value={colour.saturation}
            display={`${String(Math.round(colour.saturation))}%`}
            onChange={(saturation) => {
              onChange(withCapability(targetState, 'color_hs', { hue: colour.hue, saturation }));
            }}
          />
        </>
      )}

      {colourTemp === undefined ? null : (
        <TextField
          label="Colour temperature"
          size="compact"
          type="number"
          min={1}
          max={1000}
          value={String(colourTemp.mireds)}
          hint="Mireds."
          onChange={(event) => {
            const mireds = Number(event.target.value);

            onChange(
              withCapability(targetState, 'color_temp', {
                mireds: Number.isFinite(mireds) ? Math.round(mireds) : 300,
              }),
            );
          }}
        />
      )}

      {cover === undefined ? null : (
        <>
          <Slider
            label="Position"
            min={0}
            max={100}
            value={cover.position}
            display={`${String(Math.round(cover.position))}%`}
            onChange={(position) => {
              onChange(withCapability(targetState, 'cover', { ...cover, position }));
            }}
          />
          {cover.tilt === undefined ? null : (
            <Slider
              label="Tilt"
              min={0}
              max={100}
              value={cover.tilt}
              display={`${String(Math.round(cover.tilt))}%`}
              onChange={(tilt) => {
                onChange(withCapability(targetState, 'cover', { ...cover, tilt }));
              }}
            />
          )}
        </>
      )}

      {lock === undefined ? null : (
        <Segmented
          label="Lock"
          size="compact"
          options={[
            { value: 'locked', label: 'Locked' },
            { value: 'unlocked', label: 'Unlocked' },
          ]}
          value={lock.lockState === 'unlocked' ? 'unlocked' : 'locked'}
          onChange={(lockState) => {
            onChange(withCapability(targetState, 'lock', { lockState }));
          }}
        />
      )}

      {thermostat === undefined ? null : (
        <>
          <TextField
            label="Target temperature"
            size="compact"
            type="number"
            step={0.5}
            value={String(thermostat.targetTemperature)}
            onChange={(event) => {
              const targetTemperature = Number(event.target.value);

              onChange(
                withCapability(targetState, 'thermostat', {
                  ...thermostat,
                  targetTemperature: Number.isFinite(targetTemperature) ? targetTemperature : 21,
                }),
              );
            }}
          />
          <SelectField
            label="Mode"
            size="compact"
            options={MODE_OPTIONS}
            value={thermostat.mode}
            onChange={(mode) => {
              onChange(
                withCapability(targetState, 'thermostat', {
                  ...thermostat,
                  mode: thermostatMode(mode),
                }),
              );
            }}
          />
        </>
      )}

      {media === undefined ? null : (
        <>
          <Segmented
            label="Playback"
            size="compact"
            options={PLAYBACK_OPTIONS}
            value={playback}
            onChange={(next) => {
              onChange(
                withCapability(targetState, 'media_player', {
                  ...media,
                  playback: next,
                }),
              );
            }}
          />
          <Slider
            label="Volume"
            min={0}
            max={100}
            value={media.volume}
            display={`${String(Math.round(media.volume))}%`}
            onChange={(volume) => {
              onChange(withCapability(targetState, 'media_player', { ...media, playback, volume }));
            }}
          />
          <Segmented
            label="Muted"
            size="compact"
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            value={media.isMuted ? 'on' : 'off'}
            onChange={(value) => {
              onChange(
                withCapability(targetState, 'media_player', {
                  ...media,
                  playback,
                  isMuted: value === 'on',
                }),
              );
            }}
          />
        </>
      )}
    </div>
  );
}
