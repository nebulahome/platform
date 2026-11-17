/**
 * Tags in the command palette. A tag has no page of its own: Enter lists the devices that carry
 * it, by the device list's search, which matches tag names.
 */
import type { TagView } from '@nebulahome/contracts';

import { defineMessage, text, translate } from '@/i18n/messages';
import type { PaletteItem } from '@/palette/palette-types';
import { goTo, makeItem } from '@/palette/sources/make-item';

const KIND = defineMessage('palette.kinds.tag', 'Tag');

/**
 * The tags' rows.
 *
 * @param tags - The tags.
 * @returns The rows.
 */
export function tagItems(tags: readonly TagView[]): PaletteItem[] {
  return tags.map((tag) =>
    makeItem({
      group: 'tags',
      refId: tag.id,
      title: tag.name,
      secondary: translate('palette.tagCounts', '{{devices}}, {{entities}}', {
        devices: translate('palette.devices', {
          count: tag.deviceCount,
          defaultValue_one: '{{count}} device',
          defaultValue_other: '{{count}} devices',
        }),
        entities: translate('palette.entities', {
          count: tag.entityCount,
          defaultValue_one: '{{count}} entity',
          defaultValue_other: '{{count}} entities',
        }),
      }),
      kindLabel: text(KIND),
      exactIds: [tag.id, `tag.${tag.key}`],
      icon: { kind: 'catalogue', iconId: tag.icon, fallback: 'tag' },
      isName: true,
      primary: goTo(`/devices?q=${encodeURIComponent(tag.name)}`),
    }),
  );
}
