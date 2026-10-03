import { describe, expect, it } from 'vitest';

import { NotFoundError, ConflictError } from '@nebulahome/contracts';

import { Registry } from './registry.js';

/** The smallest thing a registry can hold. */
type Entry = { readonly id: string };

describe('Registry', () => {
  it('hands back what was registered', () => {
    const registry = new Registry<Entry>('transport');
    registry.register({ id: 'http' });

    expect(registry.require('http')).toEqual({ id: 'http' });
  });

  it('names the kind and the id when nothing is registered under it', () => {
    // The message is read by an owner whose instance failed to start, so it has to say which
    // bundle or transport was missing rather than that a lookup failed.
    const registry = new Registry<Entry>('transport');

    expect(() => registry.require('zigbee')).toThrow(NotFoundError);
    expect(() => registry.require('zigbee')).toThrow(/transport.*zigbee/);
  });

  it('refuses a second registration under the same id', () => {
    // Two bundles claiming one kind would resolve by load order, which is directory order,
    // which is not a decision anybody made.
    const registry = new Registry<Entry>('integration');
    registry.register({ id: 'shelly-gen2' });

    expect(() => {
      registry.register({ id: 'shelly-gen2' });
    }).toThrow(ConflictError);
  });

  it('takes an entry out, so that a new copy of it can be registered', () => {
    const registry = new Registry<Entry>('transport');
    registry.register({ id: 'shelly/rpc' });

    expect(registry.unregister('shelly/rpc')).toBe(true);
    expect(registry.unregister('shelly/rpc')).toBe(false);

    registry.register({ id: 'shelly/rpc' });

    expect(registry.ids()).toEqual(['shelly/rpc']);
  });

  it('reports nothing rather than throwing when a caller is only asking', () => {
    const registry = new Registry<Entry>('transport');

    expect(registry.get('zigbee')).toBeUndefined();
  });

  it('lists what it holds, so a failure can say what was available', () => {
    const registry = new Registry<Entry>('transport');
    registry.register({ id: 'http' });
    registry.register({ id: 'mqtt' });

    expect(registry.ids()).toEqual(['http', 'mqtt']);
  });
});
