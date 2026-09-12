import { describe, expect, it } from 'vitest';

import { ValidationError, parseEntityId } from '@nebula-home/contracts';

import { resolveOwner } from './entity-owner.js';

const BULB = parseEntityId('light.kitchen_ceiling');

describe('resolveOwner', () => {
  it('names the package that owns an entity a package installed', () => {
    expect(resolveOwner({ kind: 'adapter', packageId: 'pkg-nvr', integrationId: null }, BULB)).toBe(
      'pkg-nvr',
    );
  });

  it('names the integration instance that owns an entity hub adopted', () => {
    // The half that did not exist when this fold was written. An entity registered by `hub`
    // carries its instance id as `source`, and reading only `package_id` would have made every
    // one of them fail to load - which is a startup that refuses to come up because a relay was
    // adopted yesterday.
    expect(
      resolveOwner({ kind: 'adapter', packageId: null, integrationId: 'shelly-lab' }, BULB),
    ).toBe('shelly-lab');
  });

  it('passes a derived entity through as itself', () => {
    expect(resolveOwner({ kind: 'derived', packageId: null, integrationId: null }, BULB)).toBe(
      'derived',
    );
  });

  it('passes a system entity through as itself', () => {
    expect(resolveOwner({ kind: 'system', packageId: null, integrationId: null }, BULB)).toBe(
      'system',
    );
  });

  it('refuses an adapter entity with no owner at all', () => {
    // The `entities_source_consistency` constraint makes this impossible, so reaching it means
    // the database and this build disagree. Failing loudly beats an entity nobody can command.
    expect(() =>
      resolveOwner({ kind: 'adapter', packageId: null, integrationId: null }, BULB),
    ).toThrow(ValidationError);
  });

  it('refuses an adapter entity claimed by both', () => {
    // Also impossible under the constraint, and worth refusing rather than silently preferring
    // one: the two would route commands to different services.
    expect(() =>
      resolveOwner({ kind: 'adapter', packageId: 'pkg-nvr', integrationId: 'shelly-lab' }, BULB),
    ).toThrow(ValidationError);
  });
});
