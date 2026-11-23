/**
 * The calendar's two coloured marks: a model's token - a round of its colour round its icon, the
 * way a pickup shows on a day - and a calendar's mark - a rounded square with its icon, or a
 * person's initial in a round, filled when the calendar is on and drawn in outline when it is off.
 *
 * Both are painted through `--lane`, set from the tag colour by {@link LANE_CLASSES}, as the
 * automation editor's blocks are: one class picks the colour, the rest read it.
 */
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
 * The sides a calendar's mark is drawn at, and the classes for each. The icon is even on an even
 * side, so it sits on whole pixels: 11 in 18 left it half a pixel off its middle.
 */
const MARK_SIZES = {
  18: { box: 'size-4.5 text-label', square: 'rounded-check', icon: 12 },
  22: { box: 'size-5.5 text-caption', square: 'rounded-chip', icon: 14 },
} as const;

/** What a calendar's mark needs. */
export type CalendarMarkProps = {
  readonly name: string;
  readonly color: TagColor;

  /** Its icon, from the catalogue; a person's calendar has none and shows the initial. */
  readonly icon: IconView | undefined;

  /** Whether it is a person's: a round with the initial. */
  readonly isPerson: boolean;

  /** False draws it pale and a shade smaller: a calendar switched off. */
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

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-bold',
        // Switched on it springs back to size and fills; off it pales into its colour's tint.
        'transition-[background-color,color,scale] duration-220 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
        look.box,
        isPerson ? 'rounded-full' : look.square,
        isOn
          ? 'bg-[var(--lane)] text-canvas'
          : 'scale-90 bg-[color-mix(in_srgb,var(--lane)_18%,transparent)] text-[color-mix(in_srgb,var(--lane)_75%,transparent)]',
        LANE_CLASSES[color],
      )}
    >
      {isPerson ? (
        name.slice(0, 1).toUpperCase()
      ) : icon === undefined ? null : (
        <CatalogueIcon node={icon.node} frame={icon.frame} size={look.icon} />
      )}
    </span>
  );
}
