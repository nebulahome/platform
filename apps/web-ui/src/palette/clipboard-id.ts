/**
 * Whether text from the clipboard is an id of this house (docs: command palette, 6.5): an entity
 * id, a uuid, or the scope form of an area or a tag. Anything else - a word, a sentence, a
 * password - is not one, and the palette drops it at once: it is never shown, kept or sent.
 */
import { ENTITY_DOMAINS } from '@nebulahome/contracts';

import { foldForSearch } from '@/lib/search-text';
import type { PaletteGroupId, PaletteItem } from '@/palette/palette-types';

/** The longest text taken for an id. */
const MOST = 128;

/** A uuid, any version. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** `<domain>.<object_id>` and `area.<key>`, `tag.<key>`: lower case, digits and underscores. */
const DOTTED = /^([a-z_]+)\.([a-z0-9_]+)$/u;

/** What an id is, and where it is looked for. */
export type ClipboardId = {
  /** The id as copied, trimmed. */
  readonly id: string;

  /** The groups whose items it may be. */
  readonly groups: readonly PaletteGroupId[];
};

/**
 * Reads an id out of clipboard text.
 *
 * @param text - What the clipboard held.
 * @returns The id and where to look for it; null for anything that is not an id.
 */
export function parseClipboardId(text: string): ClipboardId | null {
  const id = text.trim();

  if (id === '' || id.length > MOST || /[\r\n]/u.test(id)) {
    return null;
  }

  if (UUID.test(id)) {
    // Devices are not here: a device's id is a slug, a plain word.
    return { id, groups: ['scenes', 'automations', 'pages', 'tags'] };
  }

  const domain = DOTTED.exec(id)?.[1];

  if (domain === 'area' || domain === 'tag') {
    return { id, groups: [domain === 'area' ? 'pages' : 'tags'] };
  }

  return domain !== undefined && (ENTITY_DOMAINS as readonly string[]).includes(domain)
    ? { id, groups: ['entities'] }
    : null;
}

/**
 * Finds the item an id belongs to, among what the person may see.
 *
 * @param items - The palette's items.
 * @param found - The id read from the clipboard.
 * @returns The item, or null when the id is not one of theirs.
 */
export function itemOfClipboardId(
  items: readonly PaletteItem[],
  found: ClipboardId,
): PaletteItem | null {
  const id = foldForSearch(found.id);

  return (
    items.find((item) => found.groups.includes(item.group) && item.exactIds.includes(id)) ?? null
  );
}
