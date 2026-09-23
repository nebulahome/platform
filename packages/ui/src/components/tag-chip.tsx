/**
 * A tag, as a chip: its icon in its colour, its name, and - where it can be taken off - a cross.
 *
 * Not a {@link Badge}. A badge's colour is a verdict the interface passes and the palette keeps
 * countable; a tag's colour is the owner's pick from twelve, and means only "this tag". Giving
 * the two the same component would let one colour mean two things on one page. The chip keeps
 * the badge's shape - a bordered pill, a translucent fill - so a row of the two still reads as
 * one family.
 *
 * The chip is open by default: the icon and the name side by side, where there is room for the
 * word - on the tags page, in a tag field. In a dense row it can be told to show the icon alone:
 * a device carries several tags and a row has no room for several words, but it has room for
 * several glyphs, and a glyph the owner chose says "exterior" faster than the word does once it
 * is known. The name is still there: it opens beside the icon when the chip is hovered or when
 * focus is inside it, it is the chip's `title`, and a reader hears it regardless, because hidden
 * by width is not hidden from the accessibility tree. A tag without an icon of its own is drawn
 * with the interface's tag glyph, so that every chip has one.
 *
 * The icon is drawn in the tag's colour, so colour is never the only carrier (RULES.md 15.5):
 * two tags of the same hue still differ by glyph and by name. The cross is a real button inside
 * the chip, never the chip itself: a chip is a word, and a word that is also a button is a word
 * nobody dares to click.
 */
import { cva, type VariantProps } from 'class-variance-authority';

import type { IconFrame, IconNode, TagColor } from '@nebula-home/contracts';

import { cn } from '../lib/cn.js';

import { AppIcon } from './app-icon.js';
import { CatalogueIcon } from './catalogue-icon.js';

/**
 * The classes for each colour, spelled out: Tailwind emits only the classes it can read, and a
 * class built from a key at runtime is one it cannot.
 */
const COLOR_CLASSES: Record<TagColor, string> = {
  red: 'border-tag-red/30 bg-tag-red/13 text-tag-red',
  orange: 'border-tag-orange/30 bg-tag-orange/13 text-tag-orange',
  amber: 'border-tag-amber/30 bg-tag-amber/13 text-tag-amber',
  yellow: 'border-tag-yellow/30 bg-tag-yellow/13 text-tag-yellow',
  lime: 'border-tag-lime/30 bg-tag-lime/13 text-tag-lime',
  green: 'border-tag-green/30 bg-tag-green/13 text-tag-green',
  teal: 'border-tag-teal/30 bg-tag-teal/13 text-tag-teal',
  cyan: 'border-tag-cyan/30 bg-tag-cyan/13 text-tag-cyan',
  blue: 'border-tag-blue/30 bg-tag-blue/13 text-tag-blue',
  indigo: 'border-tag-indigo/30 bg-tag-indigo/13 text-tag-indigo',
  violet: 'border-tag-violet/30 bg-tag-violet/13 text-tag-violet',
  pink: 'border-tag-pink/30 bg-tag-pink/13 text-tag-pink',
};

const chip = cva(
  'group inline-flex max-w-full shrink-0 items-center rounded-full border font-medium whitespace-nowrap',
  {
    variants: {
      size: {
        /** In a dense row, beside badges of the same size. */
        small: 'h-5 px-1 text-label',

        /** In a field, and on the tags page. */
        medium: 'h-6 px-1.5 text-caption',
      },
    },
    defaultVariants: { size: 'medium' },
  },
);

/** How large the glyph is drawn, by chip size. */
const GLYPH_SIZES = { small: 12, medium: 14 } as const;

/** What a chip needs. */
export type TagChipProps = VariantProps<typeof chip> & {
  /** Which of the palette's colours. */
  readonly color: TagColor;

  /** The tag's name. */
  readonly children: string;

  /** The tag's own icon, from the catalogue. Without it the chip draws the tag glyph. */
  readonly icon?: { readonly node: IconNode; readonly frame: IconFrame } | undefined;

  /**
   * When the name shows: always, or only when the chip is hovered or holds focus.
   *
   * `hover` is for a dense row, where a chip is one of several beside a name.
   */
  readonly reveal?: 'always' | 'hover';

  /** Called when the cross is pressed. Without it there is no cross. */
  readonly onRemove?: (() => void) | undefined;

  /** Anything extra for the outer element. */
  readonly className?: string;
};

/**
 * Renders a tag chip.
 *
 * @param props - See {@link TagChipProps}.
 * @returns The chip.
 */
export function TagChip(props: TagChipProps) {
  const { color, size, children, icon, reveal = 'always', onRemove, className } = props;
  const glyph = GLYPH_SIZES[size ?? 'medium'];

  return (
    <span title={children} className={cn(chip({ size }), COLOR_CLASSES[color], className)}>
      {icon === undefined ? (
        <AppIcon id="tag" size={glyph} />
      ) : (
        <CatalogueIcon node={icon.node} frame={icon.frame} size={glyph} />
      )}
      {/*
       * The name, and the cross with it. In a dense row they are collapsed by width rather than
       * removed, so a reader still finds the name and a keyboard still reaches the cross - and
       * reaching it is what opens the chip, through `focus-within`.
       */}
      <span
        className={cn(
          'flex min-w-0 items-center',
          reveal === 'hover'
            ? 'max-w-0 overflow-hidden opacity-0 transition-[max-width,opacity] duration-200 group-focus-within:max-w-48 group-focus-within:opacity-100 group-hover:max-w-48 group-hover:opacity-100'
            : 'max-w-48',
        )}
      >
        <span className="truncate pr-0.5 pl-1.5">{children}</span>
        {onRemove === undefined ? null : (
          <button
            type="button"
            aria-label={`Remove ${children}`}
            onClick={onRemove}
            className="ml-0.5 flex size-4 shrink-0 items-center justify-center rounded-full opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-current/40 focus-visible:outline-none"
          >
            <AppIcon id="x" size={11} strokeWidth={2.5} />
          </button>
        )}
      </span>
    </span>
  );
}
