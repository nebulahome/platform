/**
 * Which part of the library an audited action changed.
 */
import { describe, expect, it } from 'vitest';

import { libraryKindOf } from './library-events.js';

describe('libraryKindOf', () => {
  it('names the part an edit changed', () => {
    expect(libraryKindOf('area.update')).toBe('areas');
    expect(libraryKindOf('device.link')).toBe('devices');
    expect(libraryKindOf('role.update')).toBe('people');
    expect(libraryKindOf('integration.configure')).toBe('vendors');
  });

  it('announces no sign-in, token or command, which would only echo', () => {
    expect(libraryKindOf('auth.login')).toBeNull();
    expect(libraryKindOf('token.create')).toBeNull();
    expect(libraryKindOf('entity.command')).toBeNull();
    expect(libraryKindOf('scene.apply')).toBeNull();
    expect(libraryKindOf('package.install')).toBeNull();
  });
});
