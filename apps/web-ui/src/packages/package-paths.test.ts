/**
 * The platform places a package can go to: an entity opens as its card over the page that is
 * open, so a package's own page stays behind it.
 */
import { describe, expect, it } from 'vitest';

import { entityIdSchema } from '@nebulahome/contracts';

import { platformPath } from '@/packages/package-paths';

const LAMP = entityIdSchema.parse('light.kitchen');

describe('platformPath', () => {
  it('opens an entity as its card over the page that is open, on a sheet when asked', () => {
    expect(platformPath({ kind: 'entity', entityId: LAMP })).toBe('?entity=light.kitchen');
    expect(platformPath({ kind: 'entity', entityId: LAMP, view: 'settings' })).toBe(
      '?entity=light.kitchen&entity-view=settings',
    );
  });

  it('goes to a device by its own page', () => {
    expect(platformPath({ kind: 'device', deviceId: 'shelly-1' })).toBe('/devices/shelly-1');
  });
});
