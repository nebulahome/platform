import { describe, expect, it } from 'vitest';

import { itemOfClipboardId, parseClipboardId } from '@/palette/clipboard-id';
import { makeItem } from '@/palette/sources/make-item';

const UUID = '0193a5c2-7d1e-7b4a-9f3e-2c6d8a41b7e0';

describe('parseClipboardId', () => {
  it('takes an entity id of a known domain, a uuid, and an area or a tag by key', () => {
    expect(parseClipboardId(' light.hallway_light \n')?.groups).toEqual(['entities']);
    expect(parseClipboardId('alias.downstairs_lights')?.groups).toEqual(['entities']);
    expect(parseClipboardId(UUID)?.groups).toContain('scenes');
    expect(parseClipboardId('area.living_room')?.groups).toEqual(['pages']);
    expect(parseClipboardId('tag.outdoor')?.groups).toEqual(['tags']);
  });

  it('refuses a plain word, an unknown domain, two lines, a long text and nothing', () => {
    expect(parseClipboardId('kitchen')).toBeNull();
    expect(parseClipboardId('shelly.relay_one')).toBeNull();
    expect(parseClipboardId('light.hall\nlight.porch')).toBeNull();
    expect(parseClipboardId(`light.${'a'.repeat(123)}`)).toBeNull();
    expect(parseClipboardId('')).toBeNull();
  });
});

describe('itemOfClipboardId', () => {
  it('finds an item by its id only in the groups the id may be', () => {
    const scene = makeItem({
      group: 'scenes',
      refId: UUID,
      title: 'Evening',
      secondary: '',
      exactIds: [UUID],
      icon: { kind: 'ui', id: 'layers' },
      primary: { hint: 'Apply', command: { type: 'go', to: '/' } },
    });
    const found = parseClipboardId(UUID);
    const entity = parseClipboardId('light.evening');

    expect(found === null ? null : itemOfClipboardId([scene], found)).toBe(scene);
    expect(entity === null ? null : itemOfClipboardId([scene], entity)).toBeNull();
  });
});
