/**
 * The fill for each tag colour, spelled out so Tailwind can see every class.
 *
 * One map for the swatches, the dots in a list and the dots in a dropdown. It used to be copied
 * wherever a colour was drawn, which is three places that had to agree without anything making
 * them.
 */
import type { TagColor } from '@nebulahome/contracts';

/** The background class that paints a tag colour. */
export const TAG_FILL_CLASSES: Record<TagColor, string> = {
  red: 'bg-tag-red',
  orange: 'bg-tag-orange',
  amber: 'bg-tag-amber',
  yellow: 'bg-tag-yellow',
  lime: 'bg-tag-lime',
  green: 'bg-tag-green',
  teal: 'bg-tag-teal',
  cyan: 'bg-tag-cyan',
  blue: 'bg-tag-blue',
  indigo: 'bg-tag-indigo',
  violet: 'bg-tag-violet',
  pink: 'bg-tag-pink',
};

/**
 * A tag colour as a tint: a faint fill, a border and the colour itself for the text or glyph on it.
 * What a tag chip is drawn with, and anything drawn like one: a calendar's model, its mark.
 */
export const TAG_TINT_CLASSES: Record<TagColor, string> = {
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
