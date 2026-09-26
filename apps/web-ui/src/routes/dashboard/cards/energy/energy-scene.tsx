/**
 * The energy card's drawing: the house, what it has, the wires between them, and what each meter
 * says now.
 *
 * Built from parts that are each there only when the card has what they show - the panels only
 * with a panels meter, the battery only with a battery one - so a house with just a grid meter is a
 * house with just a grid wire. The labels sit on thin lines down to the part they read, the way the
 * picture it is drawn after does.
 *
 * Composed to the room the card gives it, not scaled from a fixed picture: the figures above and
 * below are the size text is read at - smaller only on a short card - and the house is as large as
 * it can be without any of their text covering it: into the bands the labels are written in,
 * where the labels leave room, and past the card's sides by a little, as the picture's does. What
 * is cut is never a label, and never the part a label reads.
 */
import type { HouseStyle } from '@nebula-home/contracts';

import { formatPower, mainSource, type PowerFlows } from '@/lib/energy-flow';
import { useElementSize } from '@/lib/use-element-size';
import { BatteryUnit, Gateway } from '@/routes/dashboard/cards/energy/battery-unit';
import { FlowWire } from '@/routes/dashboard/cards/energy/flow-wire';
import {
  geometryFor,
  outFromWall,
  PARAPET_HEIGHT,
  path,
  up,
  type HouseGeometry,
  type Point,
} from '@/routes/dashboard/cards/energy/geometry';
import { House, HouseFront } from '@/routes/dashboard/cards/energy/house';
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

  /** Which house to draw. */
  readonly houseStyle: HouseStyle;

  /** Whether the card has panels, and a battery. */
  readonly hasSolar: boolean;
  readonly hasBattery: boolean;

  /** How the power is shared out along the wires. */
  readonly flows: PowerFlows;

  /** What the whole says, for a screen reader. */
  readonly label: string;
};

/** The size the drawing is composed for until the browser has laid it out, and in a test. */
const FALLBACK_SIZE = { width: 440, height: 330 } as const;

/** The labels' figure and caption on a card tall enough, in pixels. */
const FIGURE_SIZE = 19;
const CAPTION_SIZE = 10.5;

/** The smallest a caption is written, however short the card: below it, nobody reads it. */
const MIN_CAPTION_SIZE = 9;

/** How tall a card is before its labels are full size, and the least they are scaled to. */
const FULL_LABEL_HEIGHT = 300;
const MIN_LABEL_SCALE = 0.74;

/** The room under the bottom labels' captions: air between them and what the card has below. */
const BOTTOM_AIR = 10;

/** How close to the drawing's sides a label comes: the card's own padding. */
const EDGE_MARGIN = 16;

/** How much of the house may reach past each side, as a share of the drawing's width. */
const BLEED = 0.12;

/** The room between the labels and the house. */
const BAND_GAP = 4;

/** The room kept between two labels on the same side. */
const LABEL_GAP = 14;

/**
 * The wires, each drawn from the end its forward direction starts at, and the points each
 * label's line reaches down or up to, for one house.
 *
 * @param geometry - The house.
 * @returns The wires' paths and the labels' targets, in drawing units.
 */
function wiringOf(geometry: HouseGeometry): {
  readonly wires: Readonly<Record<'solar' | 'battery' | 'home' | 'grid', string>>;
  readonly targets: Readonly<Record<'solar' | 'home' | 'battery' | 'grid', Point>>;
} {
  const { onWall, onRoof, onGround, places, wallHeight, roof, panels, targets } = geometry;
  const gateway = places.gateway;
  const run = places.wireHeight;
  // Down from the panels: off the slope's foot, or over the parapet of a flat roof.
  const fromPanels =
    roof === 'flat'
      ? [onWall(gateway.at, wallHeight + PARAPET_HEIGHT), onWall(gateway.at, wallHeight)]
      : [onRoof(gateway.at, panels.up[0] - 0.03), onWall(gateway.at, wallHeight)];

  return {
    wires: {
      solar: path([...fromPanels, outFromWall(onWall(gateway.at, gateway.top), 1.5)]),
      battery: path([
        outFromWall(onWall(places.battery.to, run), 1.5),
        outFromWall(onWall(gateway.at - gateway.halfWidth, run), 1.5),
      ]),
      home: path([
        outFromWall(onWall(gateway.at + gateway.halfWidth, run), 1.5),
        outFromWall(onWall((places.windows[0]?.from ?? 0.64) - 0.008, run), 1.5),
      ]),
      grid: path([
        onGround(gateway.at, places.gridReach),
        onGround(gateway.at, 1.5),
        outFromWall(onWall(gateway.at, gateway.bottom), 1.5),
      ]),
    },
    targets: {
      // The top of the panels, towards the gable end: the slope's top row, or the back row.
      solar:
        roof === 'flat'
          ? up(onRoof(targets.solarAlong, panels.up[1]), 16)
          : onRoof(targets.solarAlong, panels.up[1]),
      // The lit window at the far end, beside its frame, as the picture has it - the line
      // crosses only the roof's far corner, clear of the panels - or the top of the parapet.
      home:
        roof === 'flat'
          ? onWall(targets.homeAlong, wallHeight + PARAPET_HEIGHT + 5)
          : onWall(targets.homeAlong, (places.windowBand.bottom + places.windowBand.top) / 2),
      battery: outFromWall(
        onWall((places.battery.from + places.battery.to) / 2, places.battery.bottom),
        7,
      ),
      grid: onGround(gateway.at, places.gridReach),
    },
  };
}

/** How the labels are written on a card of some height. */
type LabelMetrics = {
  readonly figure: number;
  readonly caption: number;
  readonly letterSpacing: number;

  /** How much height the labels above and below the house each take. */
  readonly band: number;
};

/**
 * The labels' sizes for a drawing of some height: full size on a card tall enough, a little
 * smaller on a short one, so the house keeps some room.
 *
 * @param height - The drawing's height, in pixels.
 * @returns The sizes.
 */
function metricsFor(height: number): LabelMetrics {
  const scale = Math.min(1, Math.max(MIN_LABEL_SCALE, height / FULL_LABEL_HEIGHT));
  const figure = FIGURE_SIZE * scale;
  const caption = Math.max(MIN_CAPTION_SIZE, CAPTION_SIZE * scale);

  return {
    figure,
    caption,
    letterSpacing: 1.1 * scale,
    band: figure + caption + 6 + BOTTOM_AIR / 2,
  };
}

/** Where the house is drawn: moved, then scaled. */
type Fit = { readonly x: number; readonly y: number; readonly scale: number };

/**
 * Places a house's focus at one scale: centred between the labels' bands - over them, when it is
 * taller than the room between - then moved aside, as far as the focus allows, so what lies
 * before it on the ground stays in the drawing too.
 *
 * @param geometry - The house: its focus and its reach, in drawing units.
 * @param scale - Pixels per drawing unit.
 * @param width - The drawing's width, in pixels.
 * @param height - Its height.
 * @param band - The labels' band at the top and at the bottom.
 * @returns The move and the scale.
 */
function fitAt(
  geometry: HouseGeometry,
  scale: number,
  width: number,
  height: number,
  band: number,
): Fit {
  const { focus, reach } = geometry;
  const room = height - 2 * (band + BAND_GAP);
  const centred = width / 2 - (focus.x + focus.width / 2) * scale;
  // How far the reach sticks out on the right, and how far the focus may move left for it.
  const over = Math.max(0, centred + (reach.x + reach.width) * scale - width);
  const slack = Math.max(0, centred + focus.x * scale + BLEED * width);

  return {
    scale,
    x: centred - Math.min(over, slack),
    y: band + BAND_GAP + (room - focus.height * scale) / 2 - focus.y * scale,
  };
}

/** A rectangle, in pixels. */
type Rect = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

/**
 * Whether a rectangle and a convex polygon overlap.
 *
 * @param rect - The rectangle.
 * @param polygon - The polygon's corners, going round.
 * @returns True when any part of one is inside the other.
 */
function overlaps(rect: Rect, polygon: readonly Point[]): boolean {
  /**
   * Which side of an edge a point is on.
   *
   * @param a - The edge's start.
   * @param b - Its end.
   * @param p - The point.
   * @returns Positive on one side, negative on the other.
   */
  const side = (a: Point, b: Point, p: Point): number =>
    (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const corners: Point[] = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  const edges = polygon.map((point, index): [Point, Point] => [
    point,
    polygon[(index + 1) % polygon.length] ?? point,
  ]);
  /**
   * Whether a point is inside the polygon.
   *
   * @param p - The point.
   * @returns True when it is on the inner side of every edge.
   */
  const isInside = (p: Point): boolean => {
    const sides = edges.map(([a, b]) => side(a, b, p));

    return sides.every((each) => each >= 0) || sides.every((each) => each <= 0);
  };
  // A convex polygon and a rectangle overlap when one has a corner inside the other, or when
  // they cross - which, with no corner inside, is a polygon edge crossing a rectangle side.
  const isCrossing = edges.some(([a, b]) =>
    corners.some((c, index) => {
      const d = corners[(index + 1) % 4] ?? c;

      return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
    }),
  );

  return (
    polygon.some(
      (p) => p.x > rect.left && p.x < rect.right && p.y > rect.top && p.y < rect.bottom,
    ) ||
    corners.some(isInside) ||
    isCrossing
  );
}

/** How many times the largest scale that fits is halved towards, when searching for it. */
const FIT_STEPS = 12;

/**
 * Finds how large the house may be drawn: no smaller than fits between the labels' bands, no
 * larger than fits the drawing's height or its width with {@link BLEED}, and as large between
 * those as it goes without a label's text covering it.
 *
 * @param geometry - The house.
 * @param width - The drawing's width, in pixels.
 * @param height - Its height.
 * @param metrics - How labels are written.
 * @param labelsAt - The labels for a placement of the house.
 * @returns The placement, and the labels placed for it.
 */
function layoutOf(
  geometry: HouseGeometry,
  width: number,
  height: number,
  metrics: LabelMetrics,
  labelsAt: (fit: Fit) => { readonly top: PlacedLabel[]; readonly bottom: PlacedLabel[] },
): { readonly fit: Fit; readonly top: PlacedLabel[]; readonly bottom: PlacedLabel[] } {
  const { focus, outline } = geometry;
  const byWidth = (width * (1 + 2 * BLEED)) / focus.width;
  const least = Math.min(
    Math.max(1, height - 2 * (metrics.band + BAND_GAP)) / focus.height,
    byWidth,
  );
  const most = Math.min((height - 2 * BAND_GAP) / focus.height, byWidth);
  /**
   * The placement at one scale, and whether any label's text covers the house there.
   *
   * @param scale - The scale.
   * @returns The placement, its labels, and whether it is clear.
   */
  const tryScale = (scale: number) => {
    const fit = fitAt(geometry, scale, width, height, metrics.band);
    const labels = labelsAt(fit);
    const drawn = outline.map((point) => placed(fit, point));
    const isClear = [
      ...labels.top.map((label) => textRectOf(label, 'top', height, metrics)),
      ...labels.bottom.map((label) => textRectOf(label, 'bottom', height, metrics)),
    ].every((rect) => !overlaps(rect, drawn));

    return { fit, ...labels, isClear };
  };

  let best = tryScale(least);
  let [low, high] = [least, most];

  for (let step = 0; step < FIT_STEPS && high - low > 0.002; step += 1) {
    const middle = (low + high) / 2;
    const attempt = tryScale(middle);

    if (attempt.isClear) {
      best = attempt;
      low = middle;
    } else {
      high = middle;
    }
  }

  return best;
}

/**
 * Where a point of the house lands in the drawing.
 *
 * @param fit - How the house is placed.
 * @param point - The point, in drawing units.
 * @returns The point, in pixels.
 */
function placed(fit: Fit, point: Point): Point {
  return { x: fit.x + point.x * fit.scale, y: fit.y + point.y * fit.scale };
}

/** One label, before it is placed. */
type LabelSpec = {
  /** The point on the drawing it reads, in pixels. */
  readonly target: Point;

  /** Which side of its line the text is written on. */
  readonly side: 'left' | 'right';

  /** The figure. */
  readonly value: string;

  /** What it is, in small capitals. */
  readonly caption: string;
};

/** One label, placed. */
type PlacedLabel = LabelSpec & {
  /** Where its line runs, and where its text starts. */
  readonly lineX: number;
  readonly x: number;
};

/**
 * How wide a label's text is, at most.
 *
 * @param label - The label.
 * @param metrics - How labels are written.
 * @returns The width, in pixels.
 */
function textWidthOf(label: LabelSpec, metrics: LabelMetrics): number {
  return Math.max(
    label.value.length * metrics.figure * 0.6,
    label.caption.length * (metrics.caption * 0.72 + metrics.letterSpacing),
  );
}

/**
 * Places the labels of one side: each beside its line when it fits, pulled back inside the
 * drawing when it does not - a long figure near the right edge - and moved apart where two
 * would touch, the right one right as far as there is room, then the left one left.
 *
 * @param labels - The side's labels.
 * @param width - The drawing's width.
 * @param metrics - How labels are written.
 * @returns The labels, placed, from left to right.
 */
function placeLabels(
  labels: readonly LabelSpec[],
  width: number,
  metrics: LabelMetrics,
): PlacedLabel[] {
  const sorted = labels.toSorted((a, b) => a.target.x - b.target.x);
  const widths = sorted.map((label) => textWidthOf(label, metrics));
  const xs = sorted.map((label, index) => {
    const lineX = Math.min(Math.max(label.target.x, 2), width - 2);
    const textWidth = widths[index] ?? 0;
    const wanted = label.side === 'right' ? lineX + 6 : lineX - 6 - textWidth;

    return Math.max(EDGE_MARGIN, Math.min(wanted, width - EDGE_MARGIN - textWidth));
  });

  for (let index = 1; index < xs.length; index += 1) {
    const before = (xs[index - 1] ?? 0) + (widths[index - 1] ?? 0) + LABEL_GAP;

    if ((xs[index] ?? 0) < before) {
      const room = width - EDGE_MARGIN - (widths[index] ?? 0);

      xs[index] = Math.min(before, room);

      if (before > room) {
        xs[index - 1] = Math.max(EDGE_MARGIN, room - LABEL_GAP - (widths[index - 1] ?? 0));
      }
    }
  }

  return sorted.map((label, index) => ({
    ...label,
    lineX: Math.min(Math.max(label.target.x, 2), width - 2),
    x: xs[index] ?? EDGE_MARGIN,
  }));
}

/** What a label needs. */
type LabelProps = {
  readonly label: PlacedLabel;

  /** Above the house, or below it. */
  readonly side: 'top' | 'bottom';

  /** The drawing's height. */
  readonly height: number;

  readonly metrics: LabelMetrics;
};

/**
 * Where a label's figures stand on one side.
 *
 * @param side - Above the house, or below it.
 * @param height - The drawing's height.
 * @param metrics - How labels are written.
 * @returns The figure's and the caption's baselines.
 */
function baselinesOf(
  side: 'top' | 'bottom',
  height: number,
  metrics: LabelMetrics,
): { readonly valueY: number; readonly captionY: number } {
  return side === 'top'
    ? { valueY: metrics.figure, captionY: metrics.figure + metrics.caption + 4 }
    : {
        valueY: height - BOTTOM_AIR - metrics.caption - 4,
        captionY: height - BOTTOM_AIR,
      };
}

/**
 * The rectangle a label's text covers.
 *
 * @param label - The label, placed.
 * @param side - Above the house, or below it.
 * @param height - The drawing's height.
 * @param metrics - How labels are written.
 * @returns The rectangle, with a little air round it.
 */
function textRectOf(
  label: PlacedLabel,
  side: 'top' | 'bottom',
  height: number,
  metrics: LabelMetrics,
): Rect {
  const { valueY, captionY } = baselinesOf(side, height, metrics);

  return {
    left: label.x - 4,
    top: valueY - metrics.figure * 0.8 - 4,
    right: label.x + textWidthOf(label, metrics) + 4,
    bottom: captionY + 5,
  };
}

/**
 * One label: a figure over a caption, and the line from it to what it reads - stopping short of
 * the text when the text had to be pulled over it.
 *
 * @param props - See {@link LabelProps}.
 * @returns The group.
 */
function Label(props: LabelProps) {
  const { label, side, height, metrics } = props;
  const { target, value, lineX, x } = label;
  const words = label.caption.toUpperCase();
  const { valueY, captionY } = baselinesOf(side, height, metrics);
  const textWidth = textWidthOf(label, metrics);
  const isOverLine = x < lineX && x + textWidth > lineX;
  // Written from its left edge, or - left of its line - up to its right edge, which is where the
  // line is, whatever the text's true width.
  const isEnd = label.side === 'left' && !isOverLine;
  const anchorX = isEnd ? Math.min(x + textWidth, lineX - 6) : x;

  return (
    <g>
      <line
        x1={lineX}
        y1={side === 'top' ? (isOverLine ? captionY + 6 : 4) : target.y + 4}
        x2={lineX}
        y2={
          side === 'top'
            ? target.y - 3
            : isOverLine
              ? valueY - metrics.figure - 2
              : height - BOTTOM_AIR + 4
        }
        className="stroke-foreground-subtle"
        strokeWidth={1}
        opacity={0.45}
      />
      <text
        x={anchorX}
        y={valueY}
        fontSize={metrics.figure}
        textAnchor={isEnd ? 'end' : 'start'}
        className="fill-foreground font-semibold tabular"
      >
        {value}
      </text>
      <text
        x={anchorX}
        y={captionY}
        fontSize={metrics.caption}
        letterSpacing={metrics.letterSpacing}
        textAnchor={isEnd ? 'end' : 'start'}
        className="fill-foreground-subtle font-medium"
      >
        {words}
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
 * @returns The drawing, filling the box it is given.
 */
export function EnergyScene(props: EnergySceneProps) {
  const { meters, houseStyle, hasSolar, hasBattery, flows, label } = props;
  const { ref, size } = useElementSize<HTMLDivElement>();
  const width = size.width > 0 ? size.width : FALLBACK_SIZE.width;
  const height = size.height > 0 ? size.height : FALLBACK_SIZE.height;
  const geometry = geometryFor(houseStyle);
  const { wires, targets } = wiringOf(geometry);
  const metrics = metricsFor(height);
  const toHome = flows.solarToHome + flows.batteryToHome + flows.gridToHome;
  const charging = flows.solarToBattery + flows.gridToBattery;
  const discharging = flows.batteryToHome + flows.batteryToGrid;
  const selling = flows.solarToGrid + flows.batteryToGrid;
  const buying = flows.gridToHome + flows.gridToBattery;
  const solarOut = flows.solarToHome + flows.solarToBattery + flows.solarToGrid;
  const {
    fit,
    top: topLabels,
    bottom: bottomLabels,
  } = layoutOf(geometry, width, height, metrics, (at) => ({
    top: placeLabels(
      [
        ...(hasSolar
          ? [
              {
                target: placed(at, targets.solar),
                side: geometry.targets.solarSide,
                value: powerText(meters.solar),
                caption: 'Solar',
              },
            ]
          : []),
        {
          target: placed(at, targets.home),
          side: 'right' as const,
          value: powerText(flows.home),
          caption: 'Home',
        },
      ],
      width,
      metrics,
    ),
    bottom: placeLabels(
      [
        ...(hasBattery
          ? [
              {
                target: placed(at, targets.battery),
                side: 'right' as const,
                value: powerText(meters.battery),
                caption:
                  meters.batteryLevel === null
                    ? 'Battery'
                    : `Battery · ${String(Math.round(meters.batteryLevel))}%`,
              },
            ]
          : []),
        ...(meters.hasGrid
          ? [
              {
                target: placed(at, targets.grid),
                side: 'right' as const,
                value: powerText(meters.grid),
                caption: 'Grid',
              },
            ]
          : []),
      ],
      width,
      metrics,
    ),
  }));

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden">
      <svg
        viewBox={`0 0 ${width.toFixed(1)} ${height.toFixed(1)}`}
        role="img"
        aria-label={label}
        className="block h-full w-full"
      >
        <g
          transform={`translate(${fit.x.toFixed(2)} ${fit.y.toFixed(2)}) scale(${fit.scale.toFixed(4)})`}
        >
          <House geometry={geometry} />
          {hasSolar ? <SolarArray geometry={geometry} isProducing={solarOut > 10} /> : null}
          <HouseFront geometry={geometry} />

          {hasSolar ? (
            <FlowWire
              d={wires.solar}
              source={solarOut > 10 ? 'solar' : null}
              watts={solarOut}
              direction={1}
            />
          ) : null}
          {hasBattery ? (
            <FlowWire
              d={wires.battery}
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
            d={wires.home}
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
              d={wires.grid}
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

          <Gateway geometry={geometry} />
          {hasBattery ? <BatteryUnit geometry={geometry} level={meters.batteryLevel} /> : null}
        </g>

        {topLabels.map((each) => (
          <Label key={each.caption} label={each} side="top" height={height} metrics={metrics} />
        ))}
        {bottomLabels.map((each) => (
          <Label key={each.caption} label={each} side="bottom" height={height} metrics={metrics} />
        ))}
      </svg>
    </div>
  );
}
