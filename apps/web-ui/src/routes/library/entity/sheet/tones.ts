/**
 * The colours of the entity dialog: each kind of thing has one, and its tile, its fills and its
 * chosen options are drawn in it - warm for a lamp, green for a lock, cyan for a sensor, as the
 * entity boards of the Nebula canvas draw them.
 *
 * Written out whole, class by class, so that Tailwind finds every one of them in the source.
 */

/** A kind of thing's colour in the dialog. */
export type SheetTone =
  'lamp' | 'primary' | 'success' | 'heat' | 'cyan' | 'media' | 'violet' | 'danger' | 'muted';

/** A tile at rest: an entity that is off, or a sensor that cannot be reached. */
export const TILE_REST = 'border-border-strong bg-surface-raised text-foreground-muted';

/** A tile lit in its kind's colour. */
export const TILE_LIT: Readonly<Record<SheetTone, string>> = {
  lamp: 'border-lamp/32 bg-lamp/14 text-lamp',
  primary: 'border-primary/32 bg-primary/14 text-primary',
  success: 'border-success/30 bg-success/12 text-success',
  heat: 'border-heat/28 bg-heat/12 text-heat',
  cyan: 'border-cyan/28 bg-cyan/12 text-cyan',
  media: 'border-media/32 bg-media/14 text-media',
  violet: 'border-violet/28 bg-violet/12 text-violet',
  danger: 'border-danger/32 bg-danger/14 text-danger',
  muted: 'border-foreground-muted/26 bg-foreground-muted/10 text-foreground-muted',
};

/** The colour itself, for a glyph, a number or a line. */
export const TONE_TEXT: Readonly<Record<SheetTone, string>> = {
  lamp: 'text-lamp',
  primary: 'text-primary',
  success: 'text-success',
  heat: 'text-heat',
  cyan: 'text-cyan',
  media: 'text-media',
  violet: 'text-violet',
  danger: 'text-danger',
  muted: 'text-foreground-muted',
};

/** A dot in the colour: a chosen chip's mark. */
export const TONE_DOT: Readonly<Record<SheetTone, string>> = {
  lamp: 'bg-lamp',
  primary: 'bg-primary',
  success: 'bg-success',
  heat: 'bg-heat',
  cyan: 'bg-cyan',
  media: 'bg-media',
  violet: 'bg-violet',
  danger: 'bg-danger',
  muted: 'bg-foreground-muted',
};

/** A filled control in the colour: a switch's track, a chosen segment, a main button. */
export const TONE_FILL: Readonly<Record<SheetTone, string>> = {
  lamp: 'bg-lamp text-canvas',
  primary: 'bg-primary text-canvas',
  success: 'bg-success text-canvas',
  heat: 'bg-heat text-canvas',
  cyan: 'bg-cyan text-canvas',
  media: 'bg-media text-canvas',
  violet: 'bg-violet text-canvas',
  danger: 'bg-danger text-canvas',
  muted: 'bg-foreground-muted text-canvas',
};

/** A level below the chosen one on a levels bar: the colour, half lit. */
export const TONE_REACHED: Readonly<Record<SheetTone, string>> = {
  lamp: 'bg-lamp/48 text-foreground',
  primary: 'bg-primary/48 text-foreground',
  success: 'bg-success/48 text-foreground',
  heat: 'bg-heat/48 text-foreground',
  cyan: 'bg-cyan/48 text-foreground',
  media: 'bg-media/48 text-foreground',
  violet: 'bg-violet/48 text-foreground',
  danger: 'bg-danger/48 text-foreground',
  muted: 'bg-foreground-muted/48 text-foreground',
};

/** An option chosen among others: a chip, a quick level, a preset. */
export const TONE_CHOSEN: Readonly<Record<SheetTone, string>> = {
  lamp: 'border-lamp/50 bg-lamp/12 text-lamp',
  primary: 'border-primary/50 bg-primary/12 text-primary',
  success: 'border-success/50 bg-success/12 text-success',
  heat: 'border-heat/45 bg-heat/10 text-heat',
  cyan: 'border-cyan/45 bg-cyan/8 text-cyan',
  media: 'border-media/50 bg-media/12 text-media',
  violet: 'border-violet/45 bg-violet/10 text-violet',
  danger: 'border-danger/45 bg-danger/10 text-danger',
  muted: 'border-border-strong bg-surface-high text-foreground',
};

/**
 * The fill of a wide bar: the level reached, in one colour - a plain colour, so it can turn from
 * one to another; the bar lays its own shade over the start, darker there and brighter at the end.
 */
export const TONE_BAR: Readonly<Record<SheetTone, string>> = {
  lamp: 'bg-lamp/80',
  primary: 'bg-primary/80',
  success: 'bg-success/80',
  heat: 'bg-heat/80',
  cyan: 'bg-cyan/80',
  media: 'bg-media/80',
  violet: 'bg-violet/80',
  danger: 'bg-danger/80',
  muted: 'bg-foreground-muted/14',
};

/** The stroke and the fade under a chart's line. */
export const TONE_CHART: Readonly<Record<SheetTone, { stroke: string; fill: string }>> = {
  lamp: { stroke: 'stroke-lamp', fill: 'text-lamp' },
  primary: { stroke: 'stroke-primary', fill: 'text-primary' },
  success: { stroke: 'stroke-success', fill: 'text-success' },
  heat: { stroke: 'stroke-heat', fill: 'text-heat' },
  cyan: { stroke: 'stroke-cyan', fill: 'text-cyan' },
  media: { stroke: 'stroke-media', fill: 'text-media' },
  violet: { stroke: 'stroke-violet', fill: 'text-violet' },
  danger: { stroke: 'stroke-danger', fill: 'text-danger' },
  muted: { stroke: 'stroke-foreground-subtle', fill: 'text-foreground-subtle' },
};

/** A drawing's stroke and fill in the colour: a dial's ticks, a dot on it. */
export const TONE_SVG: Readonly<Record<SheetTone, { stroke: string; fill: string }>> = {
  lamp: { stroke: 'stroke-lamp', fill: 'fill-lamp' },
  primary: { stroke: 'stroke-primary', fill: 'fill-primary' },
  success: { stroke: 'stroke-success', fill: 'fill-success' },
  heat: { stroke: 'stroke-heat', fill: 'fill-heat' },
  cyan: { stroke: 'stroke-cyan', fill: 'fill-cyan' },
  media: { stroke: 'stroke-media', fill: 'fill-media' },
  violet: { stroke: 'stroke-violet', fill: 'fill-violet' },
  danger: { stroke: 'stroke-danger', fill: 'fill-danger' },
  muted: { stroke: 'stroke-foreground-subtle', fill: 'fill-foreground-subtle' },
};

/** A segment chosen in its colour, on a segmented row of a kind that tints it: a swing. */
export const TONE_SEGMENT: Readonly<Record<SheetTone, string>> = {
  lamp: 'bg-lamp/16 font-medium text-lamp',
  primary: 'bg-primary/16 font-medium text-primary',
  success: 'bg-success/16 font-medium text-success',
  heat: 'bg-heat/16 font-medium text-heat',
  cyan: 'bg-cyan/16 font-medium text-cyan',
  media: 'bg-media/16 font-medium text-media',
  violet: 'bg-violet/16 font-medium text-violet',
  danger: 'bg-danger/16 font-medium text-danger',
  muted: 'bg-surface-high font-medium text-foreground',
};

/** The band of a timeline: when the thing was on, open or detected. */
export const TONE_BAND: Readonly<Record<SheetTone, string>> = {
  lamp: 'bg-linear-to-b from-lamp/90 to-lamp/55',
  primary: 'bg-linear-to-b from-primary/90 to-primary/55',
  success: 'bg-linear-to-b from-success/90 to-success/55',
  heat: 'bg-linear-to-b from-heat/90 to-heat/55',
  cyan: 'bg-linear-to-b from-cyan/90 to-cyan/55',
  media: 'bg-linear-to-b from-media/90 to-media/55',
  violet: 'bg-linear-to-b from-violet/90 to-violet/55',
  danger: 'bg-linear-to-b from-danger/90 to-danger/55',
  muted: 'bg-foreground-subtle/60',
};
