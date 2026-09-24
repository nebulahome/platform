/**
 * A light: whether it is on, how bright, and the white or the colour it is making.
 *
 * A lit card takes the light's own colour - its white when it has one, its colour when it has
 * one, a lamp's warmth otherwise - and an off light keeps the same silhouette, grey, so the eye
 * knows what it is before reading a word. The tile is a switch; the tall card adds the brightness
 * as a figure and a groove; the square card makes the brightness and the white or the colour
 * something to set.
 */
import { Slider } from '@nebula-home/ui';

import {
  hsColor,
  hueGradient,
  kelvinColor,
  kelvinToMireds,
  miredsToKelvin,
  paramsOf,
  warmthGradient,
} from '@/library/entity-control';
import {
  CardFrame,
  CardHeading,
  Figure,
  Groove,
  TileRow,
} from '@/routes/dashboard/cards/card-parts';
import { cardTime, sizeKey, type EntityCardModel } from '@/routes/dashboard/cards/entity-model';
import { QuickPowerSwitch } from '@/routes/library/entity/quick-power-switch';
import { useEntityCommand } from '@/routes/library/entity/use-entity-command';
import { usePendingValue } from '@/routes/library/entity/use-pending-value';

/** How far one step of the white slider moves, in kelvin. */
const STEP_KELVIN = 50;

/**
 * The colour a light is making, for its card to be lit in.
 *
 * @param model - The card.
 * @returns A CSS colour.
 */
function lightColour(model: EntityCardModel): string {
  const { color_hs: colour, color_temp: white } = model.state;

  if (colour !== undefined && colour.saturation > 0) {
    return hsColor(colour.hue, colour.saturation);
  }

  return white === undefined ? 'var(--color-lamp)' : kelvinColor(miredsToKelvin(white.mireds));
}

/**
 * Says what a light is making, in words.
 *
 * @param model - The card.
 * @param isOn - Whether it is on.
 * @returns "2700 K", "Colour 280°", or when it went off.
 */
function lightCaption(model: EntityCardModel, isOn: boolean): string {
  if (!isOn) {
    return model.changedAt === null ? 'Off' : `Off since ${cardTime(model.changedAt)}`;
  }

  const { color_hs: colour, color_temp: white } = model.state;

  if (colour !== undefined && colour.saturation > 0) {
    return `Colour · ${String(Math.round(colour.hue))}°`;
  }

  return white === undefined ? 'On' : `White · ${String(miredsToKelvin(white.mireds))} K`;
}

/**
 * Renders a light card at its size.
 *
 * @param props - The card, ready to draw.
 * @param props.model - See {@link EntityCardModel}.
 * @returns The card.
 */
export function LightCard(props: { readonly model: EntityCardModel }) {
  const { model } = props;
  const { entity, state, reportedAt, title, subtitle, reading } = model;
  const commander = useEntityCommand(entity.entityId);
  const level = usePendingValue(state.level?.level ?? 0, reportedAt);
  const kelvin = usePendingValue(
    state.color_temp === undefined ? 0 : miredsToKelvin(state.color_temp.mireds),
    reportedAt,
  );
  const hue = usePendingValue(state.color_hs?.hue ?? 0, reportedAt);
  const isOn = state.on_off?.isOn ?? (state.level?.level ?? 0) > 0;
  const hasLevel = state.level !== undefined;
  const glow = isOn ? lightColour(model) : undefined;
  const percent = Math.round(level.shown);
  const power =
    state.on_off === undefined ? undefined : (
      <QuickPowerSwitch
        entityId={entity.entityId}
        name={title}
        isOn={state.on_off.isOn}
        reportedAt={reportedAt}
        disabled={!model.canControl}
      />
    );
  const key = sizeKey(model.size);

  if (key === '1x1') {
    return (
      <CardFrame label={title} glow={glow}>
        <TileRow
          icon={model.icon}
          kind={model.kind}
          isActive={isOn}
          isAvailable={reading.isAvailable}
          title={title}
          subtitle={hasLevel && isOn ? `${String(percent)}%` : subtitle}
          tail={power}
        />
      </CardFrame>
    );
  }

  const figure = hasLevel ? (
    <Figure
      value={isOn ? `${String(percent)}%` : 'Off'}
      size={isOn ? 'large' : 'small'}
      color={
        glow === undefined ? undefined : `color-mix(in oklab, ${glow} 40%, var(--color-foreground))`
      }
    />
  ) : (
    <Figure value={isOn ? 'On' : 'Off'} size="small" />
  );

  const groove = hasLevel ? (
    <Groove
      label="Brightness"
      percent={isOn ? percent : 0}
      fill={
        glow === undefined
          ? undefined
          : `linear-gradient(90deg, color-mix(in oklab, ${glow} 55%, black), ${glow})`
      }
    />
  ) : null;

  if (key !== '2x2') {
    return (
      <CardFrame label={title} glow={glow}>
        <CardHeading title={title} subtitle={subtitle} tail={power} />
        <div className="grow" />
        <div className="flex flex-col gap-2.5">
          {figure}
          {groove}
          <span className="truncate text-caption text-foreground-muted">
            {lightCaption(model, isOn)}
          </span>
        </div>
      </CardFrame>
    );
  }

  const whites = paramsOf(entity, 'color_temp');
  const canColour = state.color_hs !== undefined;
  const warmest = whites === null ? 0 : miredsToKelvin(whites.maxMireds);
  const coolest = whites === null ? 0 : miredsToKelvin(whites.minMireds);
  const disabled = !model.canControl;
  // A lamp that has not said its white yet sits at the warm end, and says it has no reading.
  const white = Math.min(coolest, Math.max(warmest, kelvin.shown === 0 ? warmest : kelvin.shown));
  const whiteReads = kelvin.shown === 0 ? '—' : `${String(white)} K`;

  return (
    <CardFrame label={title} glow={glow}>
      <CardHeading title={title} subtitle={subtitle} tail={power} />
      <div className="grow" />
      <div className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          {figure}
          <span className="truncate pb-1 text-caption text-foreground-muted">
            {lightCaption(model, isOn)}
          </span>
        </div>
        {hasLevel ? (
          <Slider
            label="Brightness"
            isLabelHidden
            value={percent}
            min={0}
            max={100}
            display={`${String(percent)}%`}
            fill="warm"
            disabled={disabled}
            onChange={level.hold}
            onCommit={(next) => {
              level.sent(next);
              commander.send('level', { command: 'set_level', level: next });
            }}
          />
        ) : null}
        {whites === null ? null : (
          <Slider
            label="White"
            isLabelHidden
            value={white}
            min={warmest}
            max={coolest}
            step={STEP_KELVIN}
            display={whiteReads}
            gradient={warmthGradient(warmest, coolest)}
            disabled={disabled}
            onChange={kelvin.hold}
            onCommit={(next) => {
              kelvin.sent(next);
              commander.send('color_temp', {
                command: 'set_color_temp',
                mireds: Math.min(
                  whites.maxMireds,
                  Math.max(whites.minMireds, kelvinToMireds(next)),
                ),
              });
            }}
          />
        )}
        {whites === null && canColour ? (
          <Slider
            label="Colour"
            isLabelHidden
            value={Math.round(hue.shown)}
            min={0}
            max={360}
            display={`${String(Math.round(hue.shown))}°`}
            gradient={hueGradient()}
            disabled={disabled}
            onChange={hue.hold}
            onCommit={(next) => {
              hue.sent(next);
              commander.send('color_hs', {
                command: 'set_color',
                hue: next,
                saturation: state.color_hs?.saturation ?? 100,
              });
            }}
          />
        ) : null}
        {commander.problem === null ? null : (
          <p role="alert" className="truncate text-caption text-danger">
            {commander.problem}
          </p>
        )}
      </div>
    </CardFrame>
  );
}
