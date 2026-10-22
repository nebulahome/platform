/**
 * The controls for one scene member's target state (board N-Scene-Members).
 *
 * Each capability present in `targetState` gets its own control, laid out in a grid that fits as
 * many as the row has room for: on/off, lock, playback and mode as segmented choices; levels,
 * positions and volume as the editors' bars; white and colour as their scales; a thermostat's
 * target as a stepper. A light set to off says its level and colour do not apply, and they are
 * kept rather than shown.
 *
 * There is no shared state editor elsewhere in the library; these fields are the place.
 */
import { useTranslation } from 'react-i18next';

import { THERMOSTAT_MODES, type CapabilityState, type EntityView } from '@nebulahome/contracts';
import { AppIcon, Segmented, SelectField, Slider, Stepper } from '@nebulahome/ui';

import { defineMessage, text } from '@/i18n/messages';
import {
  hueGradient,
  kelvinRangeOf,
  kelvinToMireds,
  miredsToKelvin,
  paramsOf,
  saturationGradient,
  warmthGradient,
} from '@/library/entity-control';

/** Playback options the editor offers. */
const PLAYBACK_OPTIONS = [
  {
    value: 'playing' as const,
    label: defineMessage('library.sceneMemberFields.playing', 'Playing'),
  },
  { value: 'paused' as const, label: defineMessage('library.sceneMemberFields.paused', 'Paused') },
  {
    value: 'stopped' as const,
    label: defineMessage('library.sceneMemberFields.stopped', 'Stopped'),
  },
];

/** What the member fields need. */
export type SceneMemberFieldsProps = {
  /** The target state being edited. */
  readonly targetState: CapabilityState;

  /** The entity it is for, when it is known: its whites, its modes, its range. */
  readonly entity?: EntityView | undefined;

  /** Called with the next target state. */
  readonly onChange: (targetState: CapabilityState) => void;

  /** Something more in the grid after the state's own fields: the member's transition. */
  readonly extra?: React.ReactNode;
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
 * A mode in words: `fan_only` reads "Fan only".
 *
 * @param mode - The mode.
 * @returns The words.
 */
function modeLabel(mode: string): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1).replaceAll('_', ' ');
}

/**
 * A field's name above its segmented choice, as every other field has one.
 *
 * @param props - The name and the control.
 * @param props.label - The name.
 * @param props.children - The control.
 * @returns The field.
 */
function Labelled(props: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption font-medium text-foreground-muted">{props.label}</span>
      {props.children}
    </div>
  );
}

/**
 * Renders one control per capability in the member's target state.
 *
 * @param props - See {@link SceneMemberFieldsProps}.
 * @returns The fields.
 */
export function SceneMemberFields(props: SceneMemberFieldsProps) {
  const { t } = useTranslation();

  const { targetState, entity, onChange, extra } = props;
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
  const isOff = power?.isOn === false;
  const hasLight = level !== undefined || colour !== undefined || colourTemp !== undefined;
  const kelvin = kelvinRangeOf(entity);
  const range = entity === undefined ? null : paramsOf(entity, 'thermostat');
  const modes = range?.supportedModes ?? THERMOSTAT_MODES;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5">
        {power === undefined ? null : (
          <Labelled label={t('library.sceneMemberFields.power', 'Power')}>
            <Segmented
              label={t('library.sceneMemberFields.power', 'Power')}
              size="compact"
              options={[
                { value: 'on', label: t('common.on', 'On') },
                { value: 'off', label: t('common.off', 'Off') },
              ]}
              value={power.isOn ? 'on' : 'off'}
              onChange={(value) => {
                onChange(withCapability(targetState, 'on_off', { isOn: value === 'on' }));
              }}
            />
          </Labelled>
        )}

        {level === undefined || isOff ? null : (
          <Slider
            look="bar"
            label={t('library.sceneMemberFields.level', 'Level')}
            icon={<AppIcon id="sun" size={14} />}
            min={0}
            max={100}
            value={level.level}
            display={`${String(Math.round(level.level))}%`}
            fill={colour === undefined ? 'warm' : 'violet'}
            onChange={(next) => {
              onChange(withCapability(targetState, 'level', { level: next }));
            }}
          />
        )}

        {colourTemp === undefined || isOff ? null : (
          <Slider
            look="bar"
            label={t('library.sceneMemberFields.white', 'White')}
            min={kelvin.min}
            max={kelvin.max}
            step={50}
            value={Math.min(kelvin.max, Math.max(kelvin.min, miredsToKelvin(colourTemp.mireds)))}
            display={`${String(miredsToKelvin(colourTemp.mireds))} K`}
            gradient={warmthGradient(kelvin.min, kelvin.max)}
            onChange={(next) => {
              onChange(withCapability(targetState, 'color_temp', { mireds: kelvinToMireds(next) }));
            }}
          />
        )}

        {colour === undefined || isOff ? null : (
          <>
            <Slider
              look="bar"
              label={t('library.sceneMemberFields.colour', 'Colour')}
              min={0}
              max={360}
              value={colour.hue}
              display={`${String(Math.round(colour.hue))}°`}
              gradient={hueGradient()}
              onChange={(hue) => {
                onChange(withCapability(targetState, 'color_hs', { ...colour, hue }));
              }}
            />
            <Slider
              look="bar"
              label={t('library.sceneMemberFields.saturation', 'Saturation')}
              min={0}
              max={100}
              value={colour.saturation}
              display={`${String(Math.round(colour.saturation))}%`}
              gradient={saturationGradient(colour.hue)}
              onChange={(saturation) => {
                onChange(withCapability(targetState, 'color_hs', { ...colour, saturation }));
              }}
            />
          </>
        )}

        {cover === undefined ? null : (
          <>
            <Slider
              look="bar"
              label={t('library.sceneMemberFields.position', 'Position')}
              min={0}
              max={100}
              value={cover.position}
              display={
                cover.position === 0
                  ? t('library.sceneMemberFields.closed', 'Closed')
                  : `${String(Math.round(cover.position))}%`
              }
              fill="cyan"
              onChange={(position) => {
                onChange(withCapability(targetState, 'cover', { ...cover, position }));
              }}
            />
            {cover.tilt === undefined ? null : (
              <Slider
                look="bar"
                label={t('library.sceneMemberFields.tilt', 'Tilt')}
                min={0}
                max={100}
                value={cover.tilt}
                display={`${String(Math.round(cover.tilt))}%`}
                fill="cyan"
                onChange={(tilt) => {
                  onChange(withCapability(targetState, 'cover', { ...cover, tilt }));
                }}
              />
            )}
          </>
        )}

        {lock === undefined ? null : (
          <Labelled label={t('library.sceneMemberFields.lock', 'Lock')}>
            <Segmented
              label={t('library.sceneMemberFields.lock', 'Lock')}
              size="compact"
              options={[
                { value: 'locked', label: t('library.sceneMemberFields.locked', 'Locked') },
                { value: 'unlocked', label: t('library.sceneMemberFields.unlocked', 'Unlocked') },
              ]}
              value={lock.lockState === 'unlocked' ? 'unlocked' : 'locked'}
              onChange={(lockState) => {
                onChange(withCapability(targetState, 'lock', { lockState }));
              }}
            />
          </Labelled>
        )}

        {thermostat === undefined ? null : (
          <>
            {modes.length <= 4 ? (
              <Labelled label={t('library.sceneMemberFields.mode', 'Mode')}>
                <Segmented
                  label={t('library.sceneMemberFields.mode', 'Mode')}
                  size="compact"
                  options={modes.map((mode) => ({ value: mode, label: modeLabel(mode) }))}
                  value={thermostat.mode}
                  onChange={(mode) => {
                    onChange(withCapability(targetState, 'thermostat', { ...thermostat, mode }));
                  }}
                />
              </Labelled>
            ) : (
              <SelectField
                label={t('library.sceneMemberFields.mode', 'Mode')}
                size="compact"
                options={modes.map((mode) => ({ value: mode, label: modeLabel(mode) }))}
                value={thermostat.mode}
                onChange={(mode) => {
                  const known = modes.find((one) => one === mode);

                  if (known !== undefined) {
                    onChange(
                      withCapability(targetState, 'thermostat', { ...thermostat, mode: known }),
                    );
                  }
                }}
              />
            )}
            <Stepper
              size="field"
              label={t('library.sceneMemberFields.targetTemperature', 'Target temperature')}
              min={range?.minTemperature ?? 5}
              max={range?.maxTemperature ?? 35}
              step={range?.temperatureStep ?? 0.5}
              value={thermostat.targetTemperature}
              format={(value) => `${value.toFixed(1)} °C`}
              onChange={(targetTemperature) => {
                onChange(
                  withCapability(targetState, 'thermostat', { ...thermostat, targetTemperature }),
                );
              }}
            />
          </>
        )}

        {media === undefined ? null : (
          <>
            <Labelled label={t('library.sceneMemberFields.playback', 'Playback')}>
              <Segmented
                label={t('library.sceneMemberFields.playback', 'Playback')}
                size="compact"
                options={PLAYBACK_OPTIONS.map((option) => ({
                  ...option,
                  label: text(option.label),
                }))}
                value={playback}
                onChange={(next) => {
                  onChange(
                    withCapability(targetState, 'media_player', { ...media, playback: next }),
                  );
                }}
              />
            </Labelled>
            <Slider
              look="bar"
              label={t('library.sceneMemberFields.volume', 'Volume')}
              min={0}
              max={100}
              value={media.volume}
              display={`${String(Math.round(media.volume))}%`}
              fill="violet"
              onChange={(volume) => {
                onChange(
                  withCapability(targetState, 'media_player', { ...media, playback, volume }),
                );
              }}
            />
            <Labelled label={t('library.sceneMemberFields.muted', 'Muted')}>
              <Segmented
                label={t('library.sceneMemberFields.muted', 'Muted')}
                size="compact"
                options={[
                  { value: 'off', label: t('common.no', 'No') },
                  { value: 'on', label: t('common.yes', 'Yes') },
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
            </Labelled>
          </>
        )}

        {extra}
      </div>

      {isOff && hasLight ? (
        <p className="text-caption text-foreground-subtle">
          {t(
            'library.sceneMemberFields.offKeepsTheRest',
            'Level and colour do not apply while off.',
          )}
        </p>
      ) : null}
    </div>
  );
}
