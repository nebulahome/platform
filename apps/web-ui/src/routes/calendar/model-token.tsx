/**
 * The calendar's two coloured marks: a model's token - a round of its colour round its icon, the
 * way a pickup shows on a day - and a calendar's mark - a rounded square with its icon, or a
 * person's initial in a round, filled when the calendar is on and pale when it is off.
 *
 * Both are painted through `--lane`, set from the tag colour by {@link LANE_CLASSES}, as the
 * automation editor's blocks are: one class picks the colour, the rest read it.
 */
import { useLayoutEffect, useRef, useState } from 'react';

import type { IconView, TagColor } from '@nebulahome/contracts';
import { CatalogueIcon, cn } from '@nebulahome/ui';

/** The class that sets `--lane` to each tag colour, spelled out so Tailwind sees every one. */
export const LANE_CLASSES: Readonly<Record<TagColor, string>> = {
  red: '[--lane:var(--color-tag-red)]',
  orange: '[--lane:var(--color-tag-orange)]',
  amber: '[--lane:var(--color-tag-amber)]',
  yellow: '[--lane:var(--color-tag-yellow)]',
  lime: '[--lane:var(--color-tag-lime)]',
  green: '[--lane:var(--color-tag-green)]',
  teal: '[--lane:var(--color-tag-teal)]',
  cyan: '[--lane:var(--color-tag-cyan)]',
  blue: '[--lane:var(--color-tag-blue)]',
  indigo: '[--lane:var(--color-tag-indigo)]',
  violet: '[--lane:var(--color-tag-violet)]',
  pink: '[--lane:var(--color-tag-pink)]',
};

/** The sides a token is drawn at, in pixels, and the class for each. */
const TOKEN_SIZES = {
  18: 'size-4.5',
  20: 'size-5',
  22: 'size-5.5',
  24: 'size-6',
  28: 'size-7',
  30: 'size-7.5',
  34: 'size-8.5',
} as const;

/** A side a token is drawn at. */
export type TokenSize = keyof typeof TOKEN_SIZES;

/** What a model's token needs. */
export type ModelTokenProps = {
  /** The icon, from the catalogue; a blank round while it is read. */
  readonly icon: IconView | undefined;
  readonly color: TagColor;
  readonly size?: TokenSize;

  /** What it stands for, to a screen reader; hidden when the name is beside it. */
  readonly label?: string | undefined;
  readonly className?: string;
};

/**
 * Renders a model's token.
 *
 * @param props - See {@link ModelTokenProps}.
 * @returns The token.
 */
export function ModelToken(props: ModelTokenProps) {
  const { icon, color, size = 20, label, className } = props;

  return (
    <span
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        'bg-[color-mix(in_srgb,var(--lane)_20%,transparent)] text-[var(--lane)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--lane)_45%,transparent)]',
        LANE_CLASSES[color],
        TOKEN_SIZES[size],
        className,
      )}
    >
      {icon === undefined ? null : (
        <CatalogueIcon node={icon.node} frame={icon.frame} size={Math.round(size * 0.58)} />
      )}
    </span>
  );
}

/**
 * The sides a calendar's mark is drawn at: its side, its corner's radius (the `check` and `chip`
 * radii) and its icon, even on an even side so the icon has whole pixels round it.
 */
const MARK_SIZES = {
  18: { side: 18, radius: 5, icon: 12, letter: 'text-label' },
  22: { side: 22, radius: 8, icon: 14, letter: 'text-caption' },
} as const;

/** What a calendar's mark needs. */
export type CalendarMarkProps = {
  readonly name: string;
  readonly color: TagColor;

  /** Its icon, from the catalogue; a person's calendar has none and shows the initial. */
  readonly icon: IconView | undefined;

  /** Whether it is a person's: a round with the initial. */
  readonly isPerson: boolean;

  /** False draws it pale: a calendar switched off. */
  readonly isOn?: boolean;
  readonly size?: keyof typeof MARK_SIZES;
};

/**
 * Renders a calendar's mark. It is a picture of the name beside it, so it is hidden from a
 * screen reader.
 *
 * @param props - See {@link CalendarMarkProps}.
 * @returns The mark.
 */
export function CalendarMark(props: CalendarMarkProps) {
  const { name, color, icon, isPerson, isOn = true, size = 18 } = props;
  const look = MARK_SIZES[size];
  // Off it pales into its colour's tint, and fills again when switched back on.
  const glyph = isOn ? 'text-canvas' : 'text-[color-mix(in_srgb,var(--lane)_75%,transparent)]';

  // The tile and what is on it are one drawing: at a screen scale that puts the tile on half a
  // pixel (18 px at 125 % is 22.5), a box's background snaps to the pixel and an svg or a letter
  // inside it does not, so they stood up to a pixel off; drawn together they stay centred.
  const half = look.side / 2;
  const inset = (look.side - look.icon) / 2;
  const tile = isOn
    ? 'fill-[var(--lane)]'
    : 'fill-[color-mix(in_srgb,var(--lane)_18%,transparent)]';

  return (
    <svg
      aria-hidden="true"
      width={look.side}
      height={look.side}
      viewBox={`0 0 ${String(look.side)} ${String(look.side)}`}
      className={cn('shrink-0 transition-colors duration-220 ease-out', glyph, LANE_CLASSES[color])}
    >
      {isPerson ? (
        <>
          <circle
            cx={half}
            cy={half}
            r={half}
            className={cn('transition-colors duration-220 ease-out', tile)}
          />
          <MarkLetter letter={name.slice(0, 1).toUpperCase()} half={half} className={look.letter} />
        </>
      ) : (
        <>
          <rect
            width={look.side}
            height={look.side}
            rx={look.radius}
            className={cn('transition-colors duration-220 ease-out', tile)}
          />
          {icon === undefined ? null : (
            <CatalogueIcon
              node={icon.node}
              frame={icon.frame}
              size={look.icon}
              x={inset}
              y={inset}
            />
          )}
        </>
      )}
    </svg>
  );
}

/** How far a letter's ink is centred from where its text starts, by letter and font. */
const INK_CENTRES = new Map<string, number>();

/** How much larger a letter is measured: the canvas gives its ink in whole pixels. */
const MEASURE_SCALE = 10;

/**
 * Renders a person's initial with its ink in the middle of the round. Centring the text centres
 * its advance, and a letter's ink is seldom in the middle of it (Geist's B, G and L stand up to
 * half a pixel left); so the letter is measured once, in its font, and drawn where its ink is
 * centred across. Up and down it keeps the font's middle, which caps and round letters share.
 * Until it can be measured it is centred as text.
 *
 * @param props - What it draws.
 * @param props.letter - The initial.
 * @param props.half - Half the round's side: its centre.
 * @param props.className - Its size.
 * @returns The letter.
 */
function MarkLetter(props: {
  readonly letter: string;
  readonly half: number;
  readonly className: string;
}) {
  const { letter, half, className } = props;
  const text = useRef<SVGTextElement>(null);
  const [ink, setInk] = useState<number | null>(null);

  useLayoutEffect(() => {
    // Where there is nothing to measure with (a test's document), it stays centred as text.
    if (typeof OffscreenCanvas === 'undefined') {
      return undefined;
    }

    let isLive = true;

    /** Measures the letter's ink in the font it is drawn in, once the font is there. */
    const measure = (): void => {
      const element = text.current;

      if (element === null) {
        return;
      }

      const style = getComputedStyle(element);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const large = `${style.fontWeight} ${String(parseFloat(style.fontSize) * MEASURE_SCALE)}px ${style.fontFamily}`;
      const key = `${letter} ${font}`;
      let centre = INK_CENTRES.get(key);

      if (centre === undefined) {
        const context = new OffscreenCanvas(1, 1).getContext('2d');

        if (context === null) {
          return;
        }

        context.font = large;

        const box = context.measureText(letter);

        centre = (box.actualBoundingBoxLeft - box.actualBoundingBoxRight) / 2 / MEASURE_SCALE;

        // A font still loading measures as its fallback: kept only once it is the real one.
        if (globalThis.document.fonts.check(font, letter)) {
          INK_CENTRES.set(key, centre);
        }
      }

      if (isLive) {
        setInk(centre);
      }
    };

    measure();
    void globalThis.document.fonts.ready.then(measure);

    return () => {
      isLive = false;
    };
  }, [letter]);

  return (
    <text
      ref={text}
      x={half + (ink ?? 0)}
      y={half}
      textAnchor={ink === null ? 'middle' : undefined}
      dominantBaseline="central"
      className={cn('fill-current font-bold', className)}
    >
      {letter}
    </text>
  );
}
