/**
 * The energy card's drawing: the house, what it has, the wires between them, and what each meter
 * says now.
 *
 * Built from parts that are each there only when the card has what they show - the panels only
 * with a panels meter, the battery only with a battery one - so a house with just a grid meter is a
 * house with just a grid wire. The labels sit on thin lines down to the part they read, the way the
 * picture it is drawn after does, and the whole is one box that scales to the card.
 */
import { formatPower, mainSource, type PowerFlows } from '@/lib/energy-flow';
import { BatteryUnit, Gateway } from '@/routes/dashboard/cards/energy/battery-unit';
import { FlowWire } from '@/routes/dashboard/cards/energy/flow-wire';
import {
  onGround,
  onRoof,
  onWall,
  outFromWall,
  path,
  PLACES,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  WALL_HEIGHT,
  type Point,
} from '@/routes/dashboard/cards/energy/geometry';
import { House } from '@/routes/dashboard/cards/energy/house';
import { SolarArray } from '@/routes/dashboard/cards/energy/solar-array';

/** What a meter says, as the drawing shows it; null for a meter the card does not have. */
export type SceneMeters = {
  /** What the panels make, in watts. */
  readonly solar: number | null;

  /** The battery's power, discharging positive, in watts. */
  readonly battery: number | null;

  /** How full the battery is, from 0 to 100. */
  readonly batteryLevel: number | null;

  /** The grid's power, buying positive, in watts. */
  readonly grid: number | null;

  /** Whether the card has a grid meter at all. */
  readonly hasGrid: boolean;
};

/** What the drawing needs. */
export type EnergySceneProps = {
  readonly meters: SceneMeters;

  /** Whether the card has panels, and a battery. */
  readonly hasSolar: boolean;
  readonly hasBattery: boolean;

  /** How the power is shared out along the wires. */
  readonly flows: PowerFlows;

  /** What the whole says, for a screen reader. */
  readonly label: string;
};

/** Where a wire joins the gateway, and the height the wall wires run at. */
const GATEWAY = PLACES.gateway;
const RUN = PLACES.wireHeight;

/** The wires, each drawn from the end its forward direction starts at. */
const WIRES = {
  solar: path([
    onRoof(GATEWAY.at, 0.07),
    onWall(GATEWAY.at, WALL_HEIGHT),
    outFromWall(onWall(GATEWAY.at, GATEWAY.top), 1.5),
  ]),
  battery: path([
    outFromWall(onWall(PLACES.battery.to, RUN), 1.5),
    outFromWall(onWall(GATEWAY.at - GATEWAY.halfWidth, RUN), 1.5),
  ]),
  home: path([
    outFromWall(onWall(GATEWAY.at + GATEWAY.halfWidth, RUN), 1.5),
    outFromWall(onWall(PLACES.windows[0].from - 0.008, RUN), 1.5),
  ]),
  grid: path([
    onGround(GATEWAY.at, PLACES.gridReach),
    onGround(GATEWAY.at, 1.5),
    outFromWall(onWall(GATEWAY.at, GATEWAY.bottom), 1.5),
  ]),
} as const;

/** The points each label's line reaches down or up to. */
const TARGETS = {
  solar: onRoof(0.24, 0.5),
  // Between the two windows, and far enough from the edge for a figure like 11.1 kW.
  home: onWall(0.76, 39),
  battery: outFromWall(onWall(0.13, PLACES.battery.bottom), 7),
  grid: onGround(GATEWAY.at, PLACES.gridReach),
} as const;

/** How wide a character of a label's figure is, at most, in drawing units. */
const FIGURE_CHARACTER_WIDTH = 13.6;

/** How wide a character of a label's caption is, at most, spacing included. */
const CAPTION_CHARACTER_WIDTH = 9.4;

/** How close to the box's edge a label may come. */
const EDGE_MARGIN = 4;

/** What a label needs. */
type LabelProps = {
  /** The point on the drawing it reads. */
  readonly target: Point;

  /** Above the house, or below it. */
  readonly side: 'top' | 'bottom';

  /** The figure. */
  readonly value: string;

  /** What it is, in small capitals. */
  readonly caption: string;
};

/**
 * One label: a figure over a caption, and the line from it to what it reads.
 *
 * @param props - See {@link LabelProps}.
 * @returns The group.
 */
function Label(props: LabelProps) {
  const { target, side, value, caption } = props;
  const valueY = side === 'top' ? 26 : VIEW_HEIGHT - 24;
  const captionY = side === 'top' ? 42 : VIEW_HEIGHT - 7;
  // Beside its line when it fits, and pulled back inside the box when it does not - a long figure
  // on a label near the right edge - with its line then stopping short of the text.
  const width = Math.max(
    value.length * FIGURE_CHARACTER_WIDTH,
    caption.toUpperCase().length * CAPTION_CHARACTER_WIDTH,
  );
  const x = Math.min(target.x + 6, VIEW_WIDTH - EDGE_MARGIN - width);
  const isOverLine = x < target.x;

  return (
    <g>
      <line
        x1={target.x}
        y1={side === 'top' ? (isOverLine ? captionY + 6 : 8) : target.y + 4}
        x2={target.x}
        y2={side === 'top' ? target.y - 3 : isOverLine ? valueY - 22 : VIEW_HEIGHT - 4}
        className="stroke-foreground-subtle"
        strokeWidth={1}
        opacity={0.45}
      />
      <text x={x} y={valueY} fontSize={22} className="fill-foreground font-semibold tabular">
        {value}
      </text>
      <text
        x={x}
        y={captionY}
        fontSize={11}
        letterSpacing={1.2}
        className="fill-foreground-subtle font-medium"
      >
        {caption.toUpperCase()}
      </text>
    </g>
  );
}

/**
 * Writes a power for a label.
 *
 * @param watts - The power, or null when the meter says nothing.
 * @returns The figure.
 */
function powerText(watts: number | null): string {
  if (watts === null) {
    return '—';
  }

  const { value, unit } = formatPower(watts);

  return `${value} ${unit}`;
}

/**
 * Renders the drawing.
 *
 * @param props - See {@link EnergySceneProps}.
 * @returns The SVG.
 */
export function EnergyScene(props: EnergySceneProps) {
  const { meters, hasSolar, hasBattery, flows, label } = props;
  const toHome = flows.solarToHome + flows.batteryToHome + flows.gridToHome;
  const charging = flows.solarToBattery + flows.gridToBattery;
  const discharging = flows.batteryToHome + flows.batteryToGrid;
  const selling = flows.solarToGrid + flows.batteryToGrid;
  const buying = flows.gridToHome + flows.gridToBattery;
  const solarOut = flows.solarToHome + flows.solarToBattery + flows.solarToGrid;

  return (
    <svg
      viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(VIEW_HEIGHT)}`}
      role="img"
      aria-label={label}
      className="block h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <House />
      {hasSolar ? <SolarArray isProducing={solarOut > 10} /> : null}

      {hasSolar ? (
        <FlowWire
          d={WIRES.solar}
          source={solarOut > 10 ? 'solar' : null}
          watts={solarOut}
          direction={1}
        />
      ) : null}
      {hasBattery ? (
        <FlowWire
          d={WIRES.battery}
          source={
            charging > discharging
              ? mainSource({ solar: flows.solarToBattery, grid: flows.gridToBattery })
              : discharging > 10
                ? 'battery'
                : null
          }
          watts={Math.max(charging, discharging)}
          direction={charging > discharging ? -1 : 1}
        />
      ) : null}
      <FlowWire
        d={WIRES.home}
        source={mainSource({
          solar: flows.solarToHome,
          battery: flows.batteryToHome,
          grid: flows.gridToHome,
        })}
        watts={toHome}
        direction={1}
      />
      {meters.hasGrid ? (
        <FlowWire
          d={WIRES.grid}
          source={
            selling > buying
              ? mainSource({ solar: flows.solarToGrid, battery: flows.batteryToGrid })
              : buying > 10
                ? 'grid'
                : null
          }
          watts={Math.max(selling, buying)}
          direction={selling > buying ? -1 : 1}
        />
      ) : null}

      <Gateway />
      {hasBattery ? <BatteryUnit level={meters.batteryLevel} /> : null}

      {hasSolar ? (
        <Label target={TARGETS.solar} side="top" value={powerText(meters.solar)} caption="Solar" />
      ) : null}
      <Label target={TARGETS.home} side="top" value={powerText(flows.home)} caption="Home" />
      {hasBattery ? (
        <Label
          target={TARGETS.battery}
          side="bottom"
          value={powerText(meters.battery)}
          caption={
            meters.batteryLevel === null
              ? 'Battery'
              : `Battery · ${String(Math.round(meters.batteryLevel))}%`
          }
        />
      ) : null}
      {meters.hasGrid ? (
        <Label target={TARGETS.grid} side="bottom" value={powerText(meters.grid)} caption="Grid" />
      ) : null}
    </svg>
  );
}
