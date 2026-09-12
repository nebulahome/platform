import { describe, expect, it } from 'vitest';

import { integrationSetupSchema, type IntegrationSetup } from '@nebula-home/contracts';

import { needsSetup, withVendorSettings, type VendorSettings } from './vendors.js';

/** An instance of a cloud vendor's driver, as read from the registry and opened. */
const INSTANCE = {
  id: 'acme-1',
  kind: 'acme/plug',
  kindVersion: '1.0.0',
  transport: 'http',
  transportConfig: { hosts: ['192.168.1.40'], region: 'eu' },
  options: { pollEveryMs: 5000 },
  isEnabled: true,
};

/** A vendor that asks for an API key. */
const KEYED: IntegrationSetup = integrationSetupSchema.parse({
  transport: { fields: [{ key: 'apiKey', type: 'secret', label: 'API key', isRequired: true }] },
});

/** A vendor that asks for nothing anybody has to answer. */
const OPTIONAL: IntegrationSetup = integrationSetupSchema.parse({
  transport: { fields: [{ key: 'region', type: 'text', label: 'Region' }] },
});

/** What the owner saved for the keyed vendor, secrets already opened. */
const SAVED: VendorSettings = {
  transportConfig: { apiKey: 'k-123', region: 'us' },
  options: { pollEveryMs: 60_000, account: 'home' },
};

describe('needsSetup', () => {
  it('is true for a vendor that asks for something required and has nothing saved', () => {
    expect(needsSetup(KEYED, undefined)).toBe(true);
  });

  it('is false once anything is saved', () => {
    // Whether what was saved is complete is the API's check at save time; here the question is
    // only whether the owner has been asked at all.
    expect(needsSetup(KEYED, SAVED)).toBe(false);
  });

  it('is false for a vendor that asks for nothing required, saved or not', () => {
    expect(needsSetup(OPTIONAL, undefined)).toBe(false);
  });
});

describe('withVendorSettings', () => {
  it('puts the vendor settings under the instance, so the instance wins where both speak', () => {
    // The vendor's region is a default for every device; the instance said `eu` for this one.
    const layered = withVendorSettings(INSTANCE, 'ACME', KEYED, SAVED);

    expect(layered.transportConfig).toEqual({
      apiKey: 'k-123',
      region: 'eu',
      hosts: ['192.168.1.40'],
    });
    expect(layered.options).toEqual({ pollEveryMs: 5000, account: 'home' });
  });

  it('leaves everything else about the instance as it was', () => {
    const layered = withVendorSettings(INSTANCE, 'ACME', KEYED, SAVED);

    expect([layered.id, layered.kind, layered.transport, layered.isEnabled]).toEqual([
      'acme-1',
      'acme/plug',
      'http',
      true,
    ]);
  });

  it('refuses to start an instance of a vendor nobody has set up yet', () => {
    // Recorded as the instance's failure by the caller, in words that send the owner to the
    // vendor page rather than to the device: the address is fine, the key is missing.
    expect(() => withVendorSettings(INSTANCE, 'ACME', KEYED, undefined)).toThrow(
      /ACME needs setting up/,
    );
  });

  it('starts an instance of a vendor that asks for nothing required without a row', () => {
    const layered = withVendorSettings(INSTANCE, 'ACME', OPTIONAL, undefined);

    expect(layered.transportConfig).toEqual(INSTANCE.transportConfig);
  });
});
