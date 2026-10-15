/**
 * What each tag colour is called on screen.
 *
 * The colour itself is a stored value and stays as it is; only the word beside its swatch follows
 * the reader's language.
 */
import type { TagColor } from '@nebulahome/contracts';

import { defineMessage, text, type Message } from '@/i18n/messages';

/** The word for each colour. */
const NAMES: Readonly<Record<TagColor, Message>> = {
  red: defineMessage('colours.red', 'Red'),
  orange: defineMessage('colours.orange', 'Orange'),
  amber: defineMessage('colours.amber', 'Amber'),
  yellow: defineMessage('colours.yellow', 'Yellow'),
  lime: defineMessage('colours.lime', 'Lime'),
  green: defineMessage('colours.green', 'Green'),
  teal: defineMessage('colours.teal', 'Teal'),
  cyan: defineMessage('colours.cyan', 'Cyan'),
  blue: defineMessage('colours.blue', 'Blue'),
  indigo: defineMessage('colours.indigo', 'Indigo'),
  violet: defineMessage('colours.violet', 'Violet'),
  pink: defineMessage('colours.pink', 'Pink'),
};

/**
 * Names a tag colour.
 *
 * @param colour - The colour.
 * @returns Its name, in the reader's language.
 */
export function tagColourName(colour: TagColor): string {
  return text(NAMES[colour]);
}
