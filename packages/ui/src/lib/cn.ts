import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The theme's own steps, as `styles.css` declares them, told to the merger.
 *
 * Without them tailwind-merge reads `text-ui` as a colour - it knows no type step called `ui` -
 * and a later `text-transparent` or `text-foreground` quietly removes the size, the line height
 * and the tracking with it. The radii and the shadows are named for the same reason: unknown,
 * `rounded-field rounded-full` kept both and let the stylesheet's order pick the winner.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        'label',
        'caption',
        'ui',
        'title',
        'subhead',
        'head',
        'headline',
        'reading',
        'reading-lg',
      ],
      radius: ['chip', 'field', 'tile', 'panel', 'dialog'],
      shadow: ['sunk', 'raised', 'card', 'dialog'],
    },
  },
});

/**
 * Merge Tailwind class names, letting later classes win over conflicting earlier ones.
 *
 * Plain string concatenation cannot do this: `"p-2 p-4"` leaves both classes in the DOM and the
 * winner depends on stylesheet order rather than on call order.
 *
 * @param inputs - Class values, in the shape clsx accepts.
 * @returns A single class string with Tailwind conflicts resolved.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
