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
