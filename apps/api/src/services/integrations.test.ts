/**
 * The pure half of configuring an integration: what is checked, what is stored, what is served.
 *
 * The other half - rows, the hub over the bus - is exercised against the real stack. What is
 * tested here is everything between the form and the row: the bundle's declaration applied to
 * what was typed, the constants the bundle owns, the secrets that must never come back out.
 */
import { describe, expect, it } from 'vitest';

import {
  integrationSetupSchema,
  integrationVendorSchema,
  ValidationError,
  type IntegrationVendor,
} from '@nebula-home/contracts';
import { isSealed, openSecrets, secretsKeyFrom } from '@nebula-home/db';

import {
  checkModel,
  forStorage,
  layeredTransportConfig,
  servedConfig,
  validateSetup,
  vendorViewOf,
  withoutSecrets,
} from './integrations.js';

/** The key the hub would open with. */
const KEY = secretsKeyFrom('cd'.repeat(32));

/** The printer bundle's declaration. */
const SETUP = integrationSetupSchema.parse({
  transport: {
    constants: { username: 'bblp', shouldVerifyCertificate: false },
    fields: [
      { key: 'url', type: 'text', label: 'Printer address', isRequired: true },
      { key: 'password', type: 'secret', label: 'Access code', isRequired: true, minLength: 8 },
    ],
  },
  options: {
    fields: [{ key: 'pollMs', type: 'number', label: 'Poll', default: 5000 }],
  },
});

/**
 * A cloud vendor as the hub lists it: one API key to give once, one driver of two models.
 *
 * @param setup - What the vendor asks, when not the key.
 * @returns The catalogue entry.
 */
function vendor(
  setup: unknown = {
    transport: { fields: [{ key: 'apiKey', type: 'secret', label: 'API key', isRequired: true }] },
  },
): IntegrationVendor {
  return integrationVendorSchema.parse({
    id: 'acme',
    version: '2.0.0',
    name: 'ACME',
    internetRequired: true,
    transports: ['http'],
    setup,
    drivers: [
      {
        id: 'acme/plug',
        vendorId: 'acme',
        driverId: 'plug',
        name: 'Plug',
        transport: 'http',
        models: ['Plug S', 'Plug XL'],
        setup: {
          transport: {
            constants: { region: 'eu' },
            fields: [{ key: 'host', type: 'text', label: 'Address', isRequired: true }],
          },
        },
      },
      {
        id: 'acme/bulb',
        vendorId: 'acme',
        driverId: 'bulb',
        name: 'Bulb',
        transport: 'http',
        models: [],
        setup: { transport: { fields: [] } },
      },
    ],
  });
}

describe('vendorViewOf', () => {
  it('says a vendor that asks for a key nobody has given still needs setting up', () => {
    const view = vendorViewOf(vendor(), undefined, { instances: 0, devices: 0, entities: 0 });

    expect([view.needsSetup, view.isConfigured, view.configuredAt]).toEqual([true, false, null]);
  });

  it('serves what was saved with its secrets withheld, and counts what came in', () => {
    const saved = forStorage(
      vendor().setup,
      { transportConfig: { apiKey: 'k-123' }, options: {} },
      KEY,
    );
    const view = vendorViewOf(
      vendor(),
      { ...saved, updatedAt: new Date('2026-09-12T10:00:00Z') },
      { instances: 2, devices: 3, entities: 9 },
    );

    expect([view.needsSetup, view.isConfigured]).toEqual([false, true]);
    expect(view.transportConfig).toEqual({ apiKey: { $sealed: true } });
    expect(view.configuredAt).toEqual(new Date('2026-09-12T10:00:00Z'));
    expect([view.instanceCount, view.deviceCount, view.entityCount]).toEqual([2, 3, 9]);
  });

  it('never says a vendor that asks for nothing required needs setting up', () => {
    const view = vendorViewOf(
      vendor({ transport: { fields: [{ key: 'region', type: 'text', label: 'Region' }] } }),
      undefined,
      { instances: 0, devices: 0, entities: 0 },
    );

    expect(view.needsSetup).toBe(false);
  });
});

describe('checkModel', () => {
  it('accepts a model the driver lists', () => {
    expect(checkModel(vendor(), 'acme/plug', 'Plug XL')).toBe('Plug XL');
  });

  it('accepts the driver name as the model of a driver that lists none', () => {
    expect(checkModel(vendor(), 'acme/bulb', 'Bulb')).toBe('Bulb');
  });

  it('refuses a model the driver does not offer, naming what it does', () => {
    // The pick is what the vendor page shows for the row, so a label the bundle never made a
    // choice of - a typo, a model from another driver - is refused rather than written.
    let caught: unknown;

    try {
      checkModel(vendor(), 'acme/plug', 'Bulb');
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught instanceof ValidationError ? caught.details : undefined).toEqual({
      issues: [{ path: 'model', message: expect.any(String) as string }],
      choices: ['Plug S', 'Plug XL'],
    });
  });
});

describe('layeredTransportConfig', () => {
  it('stacks the driver constants, the vendor settings, the kept secrets and what was typed', () => {
    // Lowest to highest: what the bundle fixes for every device, what the owner gave the vendor
    // once, what this instance already has sealed, and what the form just sent.
    const layered = layeredTransportConfig(
      { region: 'eu', shouldVerifyCertificate: false },
      { apiKey: { $sealed: 'v1.abc' }, region: 'us' },
      { password: { $sealed: 'v1.def' } },
      { host: '192.168.1.40', region: 'de' },
    );

    expect(layered).toEqual({
      shouldVerifyCertificate: false,
      apiKey: { $sealed: 'v1.abc' },
      password: { $sealed: 'v1.def' },
      host: '192.168.1.40',
      region: 'de',
    });
  });
});

describe('validateSetup', () => {
  it('returns the values as typed, with declared defaults filled in', () => {
    expect(
      validateSetup(
        SETUP,
        { transportConfig: { url: 'mqtts://a', password: '12345678' }, options: {} },
        'complete',
      ),
    ).toEqual({
      transportConfig: { url: 'mqtts://a', password: '12345678' },
      options: { pollMs: 5000 },
    });
  });

  it('names the group and the field a form has to highlight', () => {
    let caught: unknown;

    try {
      validateSetup(SETUP, { transportConfig: { url: 'mqtts://a' }, options: {} }, 'complete');
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught instanceof ValidationError ? caught.details['issues'] : undefined).toEqual([
      { path: 'transportConfig.password', message: expect.any(String) as string },
    ]);
  });

  it('refuses a constant sent from the client, whatever the mode', () => {
    expect(() =>
      validateSetup(SETUP, { transportConfig: { username: 'admin' }, options: {} }, 'partial'),
    ).toThrow(ValidationError);
  });
});

describe('forStorage', () => {
  it('adds the bundle constants and seals the secrets, leaving the rest readable', () => {
    const stored = forStorage(
      SETUP,
      { transportConfig: { url: 'mqtts://a', password: '12345678' }, options: { pollMs: 5000 } },
      KEY,
    );

    expect(stored.transportConfig['url']).toBe('mqtts://a');
    expect(stored.transportConfig['username']).toBe('bblp');
    expect(stored.transportConfig['shouldVerifyCertificate']).toBe(false);
    expect(isSealed(stored.transportConfig['password'])).toBe(true);
    expect(openSecrets(stored.transportConfig, KEY)['password']).toBe('12345678');
    expect(stored.options).toEqual({ pollMs: 5000 });
  });

  it('carries a secret that is still sealed through unchanged, so a change keeps it', () => {
    const first = forStorage(
      SETUP,
      { transportConfig: { url: 'mqtts://a', password: '12345678' }, options: {} },
      KEY,
    );
    const second = forStorage(
      SETUP,
      { transportConfig: { ...first.transportConfig, url: 'mqtts://b' }, options: {} },
      KEY,
    );

    expect(second.transportConfig['password']).toEqual(first.transportConfig['password']);
    expect(second.transportConfig['url']).toBe('mqtts://b');
  });
});

describe('servedConfig', () => {
  it('turns a sealed secret into a flag and drops a plain one, whatever it is called', () => {
    const stored = forStorage(
      SETUP,
      { transportConfig: { url: 'mqtts://a', password: '12345678' }, options: {} },
      KEY,
    );

    expect(servedConfig(stored.transportConfig)).toEqual({
      url: 'mqtts://a',
      username: 'bblp',
      shouldVerifyCertificate: false,
      password: { $sealed: true },
    });
    expect(servedConfig({ hosts: ['a'], password: 'typed by hand', apiKey: 'x' })).toEqual({
      hosts: ['a'],
    });
  });

  it('treats a column that is not an object as empty', () => {
    expect(servedConfig(null)).toEqual({});
    expect(servedConfig(42)).toEqual({});
  });
});

describe('withoutSecrets', () => {
  it('keeps the configuration somebody needs to see', () => {
    expect(withoutSecrets({ hosts: ['192.168.1.42'], isSecure: false, timeoutMs: 4000 })).toEqual({
      hosts: ['192.168.1.42'],
      isSecure: false,
      timeoutMs: 4000,
    });
  });

  it('removes a secret whatever it is called, and is not fooled by capitals', () => {
    // The same secret is spelled four ways depending on who wrote the transport.
    const served = withoutSecrets({
      username: 'nebula',
      apiKey: 'a',
      api_key: 'b',
      accessToken: 'c',
      clientSecret: 'd',
      mqttCredentials: 'e',
      PASSWORD: 'x',
    });

    // The username stays: it is not a secret, and hiding it would make the form unusable.
    expect(served).toEqual({ username: 'nebula' });
  });

  it('removes rather than starring out', () => {
    // A placeholder is a value, and a form that sent one back would write the placeholder into
    // the row. Absent means the merge on the way in leaves what is there alone.
    expect('password' in withoutSecrets({ password: 'x' })).toBe(false);
  });
});
