import { describe, expect, it } from 'vitest';

import {
  asksAnythingRequired,
  integrationSetupSchema,
  isFieldShown,
  pollIntervalMsOf,
  secretKeysOf,
  setupValueSchema,
  withPollingField,
  type IntegrationSetup,
} from './integration-setup.js';

/**
 * The declaration a printer bundle ships: two things to ask, two things it knows.
 *
 * @returns The declaration, as read off disk.
 */
function printer(): Record<string, unknown> {
  return {
    transport: {
      constants: { username: 'bblp', shouldVerifyCertificate: false },
      fields: [
        {
          key: 'url',
          type: 'text',
          label: 'Printer address',
          isRequired: true,
          placeholder: 'mqtts://192.168.1.60:8883',
          pattern: '^mqtts?://.+',
        },
        {
          key: 'password',
          type: 'secret',
          label: 'Access code',
          isRequired: true,
          minLength: 8,
          maxLength: 8,
        },
      ],
    },
  };
}

/**
 * A declaration with one field of each remaining kind, for the value schema.
 *
 * @returns The declaration.
 */
function everyKind(): IntegrationSetup {
  return integrationSetupSchema.parse({
    transport: {
      fields: [
        { key: 'hosts', type: 'list', label: 'Addresses', isRequired: true, minItems: 1 },
        {
          key: 'pollMs',
          type: 'number',
          label: 'Poll every',
          min: 100,
          max: 60_000,
          isInteger: true,
          default: 5000,
        },
        { key: 'isSecure', type: 'boolean', label: 'HTTPS', default: false },
        {
          key: 'speed',
          type: 'choice',
          label: 'Speed',
          choices: [
            { value: 'slow', label: 'Slow' },
            { value: 'fast', label: 'Fast' },
          ],
        },
        { key: 'note', type: 'text', label: 'Note', maxLength: 10 },
      ],
    },
  });
}

describe('integrationSetupSchema', () => {
  it('reads a bundle declaration, defaulting what it leaves out', () => {
    const setup = integrationSetupSchema.parse(printer());

    expect(setup.transport.constants).toEqual({ username: 'bblp', shouldVerifyCertificate: false });
    expect(setup.transport.fields.map((field) => field.key)).toEqual(['url', 'password']);
    expect(setup.options).toEqual({ constants: {}, fields: [] });
  });

  it('refuses two fields with one key', () => {
    const declaration = printer();
    const transport = declaration['transport'] as { fields: unknown[] };

    transport.fields.push({ key: 'url', type: 'text', label: 'Again' });

    expect(() => integrationSetupSchema.parse(declaration)).toThrow(/url/u);
  });

  it('refuses a constant that a field also asks for', () => {
    const declaration = printer();
    const transport = declaration['transport'] as { constants: Record<string, unknown> };

    transport.constants['url'] = 'mqtt://fixed';

    expect(() => integrationSetupSchema.parse(declaration)).toThrow(/url/u);
  });

  it('refuses a key that is not an identifier, and a type it does not know', () => {
    expect(() =>
      integrationSetupSchema.parse({
        transport: { fields: [{ key: 'printer address', type: 'text', label: 'x' }] },
      }),
    ).toThrow();
    expect(() =>
      integrationSetupSchema.parse({
        transport: { fields: [{ key: 'colour', type: 'color', label: 'x' }] },
      }),
    ).toThrow();
  });
});

describe('setupValueSchema', () => {
  it('accepts what the form collects for the printer', () => {
    const schema = setupValueSchema(integrationSetupSchema.parse(printer()).transport, 'complete');

    expect(schema.parse({ url: 'mqtts://192.168.1.60:8883', password: '12345678' })).toEqual({
      url: 'mqtts://192.168.1.60:8883',
      password: '12345678',
    });
  });

  it('names the required field that is missing', () => {
    const schema = setupValueSchema(integrationSetupSchema.parse(printer()).transport, 'complete');
    const result = schema.safeParse({ url: 'mqtts://192.168.1.60:8883' });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([['password']]);
  });

  it('holds a text field to its pattern and a secret to its length', () => {
    const schema = setupValueSchema(integrationSetupSchema.parse(printer()).transport, 'complete');

    expect(schema.safeParse({ url: 'http://nope', password: '12345678' }).success).toBe(false);
    expect(schema.safeParse({ url: 'mqtts://a', password: '1234' }).success).toBe(false);
  });

  it('reports a mismatch in the words the bundle chose, when it chose some', () => {
    const setup = integrationSetupSchema.parse({
      transport: {
        fields: [
          {
            key: 'url',
            type: 'text',
            label: 'Printer address',
            isRequired: true,
            pattern: '^mqtts://.+',
            patternMessage: 'Must start with mqtts://, the printer only speaks TLS.',
          },
          {
            key: 'hosts',
            type: 'list',
            label: 'Addresses',
            pattern: '^[0-9.]+$',
            patternMessage: 'Addresses only.',
          },
        ],
      },
    });
    const schema = setupValueSchema(setup.transport, 'complete');
    const result = schema.safeParse({ url: 'mqtt://192.168.1.60:1883', hosts: ['not an ip'] });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [['url'], 'Must start with mqtts://, the printer only speaks TLS.'],
      [['hosts', 0], 'Addresses only.'],
    ]);
  });

  it('refuses a key the bundle did not declare, constants included', () => {
    // A constant is the bundle's to set. A client that could send `username` could also send
    // `shouldVerifyCertificate: true` and take the printer offline while looking configured.
    const schema = setupValueSchema(integrationSetupSchema.parse(printer()).transport, 'complete');

    expect(
      schema.safeParse({ url: 'mqtts://a', password: '12345678', username: 'other' }).success,
    ).toBe(false);
  });

  it('types numbers, booleans, choices and lists, and fills declared defaults', () => {
    const schema = setupValueSchema(everyKind().transport, 'complete');

    expect(schema.parse({ hosts: ['192.168.1.40'], speed: 'fast' })).toEqual({
      hosts: ['192.168.1.40'],
      pollMs: 5000,
      isSecure: false,
      speed: 'fast',
    });
    expect(schema.safeParse({ hosts: [], speed: 'fast' }).success).toBe(false);
    expect(schema.safeParse({ hosts: ['a'], pollMs: 50 }).success).toBe(false);
    expect(schema.safeParse({ hosts: ['a'], pollMs: 100.5 }).success).toBe(false);
    expect(schema.safeParse({ hosts: ['a'], speed: 'warp' }).success).toBe(false);
    expect(schema.safeParse({ hosts: ['a'], isSecure: 'yes' }).success).toBe(false);
    expect(schema.safeParse({ hosts: ['a'], note: 'far too long a note' }).success).toBe(false);
  });

  it('makes every field optional and fills nothing when validating a change', () => {
    // A PATCH sends only what changed; the API merges it over the row. A default filled in
    // here would overwrite a value the owner set on purpose.
    const schema = setupValueSchema(everyKind().transport, 'partial');

    expect(schema.parse({ speed: 'slow' })).toEqual({ speed: 'slow' });
    expect(schema.safeParse({ hosts: [] }).success).toBe(false);
    expect(schema.safeParse({ elsewhere: 1 }).success).toBe(false);
  });
});

describe('shownWhen', () => {
  /**
   * An inverter reached over Modbus or through its dongle's web page: a unit id for one, a
   * password for the other.
   *
   * @returns The declaration, as read off disk.
   */
  function inverter(): Record<string, unknown> {
    return {
      transport: {
        fields: [
          {
            key: 'connection',
            type: 'choice',
            label: 'Connection',
            choices: [
              { value: 'modbus', label: 'Modbus TCP' },
              { value: 'dongle', label: 'Web API' },
            ],
            default: 'modbus',
          },
          { key: 'host', type: 'text', label: 'Address', isRequired: true },
          {
            key: 'unitId',
            type: 'number',
            label: 'Unit id',
            isRequired: true,
            default: 1,
            shownWhen: { key: 'connection', equals: ['modbus'] },
          },
          {
            key: 'password',
            type: 'secret',
            label: 'Password',
            isRequired: true,
            shownWhen: { key: 'connection', equals: ['dongle'] },
          },
        ],
      },
    };
  }

  it('asks a field only while the choice before it holds one of its values', () => {
    const group = integrationSetupSchema.parse(inverter()).transport;
    const [, , unitId, password] = group.fields;

    expect(unitId && isFieldShown(group, unitId, {})).toBe(true);
    expect(password && isFieldShown(group, password, {})).toBe(false);
    expect(password && isFieldShown(group, password, { connection: 'dongle' })).toBe(true);
    expect(unitId && isFieldShown(group, unitId, { connection: 'dongle' })).toBe(false);
  });

  it('requires and defaults a field only while it is asked, and drops it otherwise', () => {
    const schema = setupValueSchema(integrationSetupSchema.parse(inverter()).transport, 'complete');

    expect(schema.parse({ host: '192.168.1.80' })).toEqual({
      connection: 'modbus',
      host: '192.168.1.80',
      unitId: 1,
    });
    expect(
      schema.parse({
        connection: 'dongle',
        host: '192.168.1.80',
        password: 'SXXXXXXXXX',
        unitId: 4,
      }),
    ).toEqual({ connection: 'dongle', host: '192.168.1.80', password: 'SXXXXXXXXX' });

    const missing = schema.safeParse({ connection: 'dongle', host: '192.168.1.80' });

    expect(missing.error?.issues.map((issue) => issue.path)).toEqual([['password']]);
  });

  it('keeps everything a change sends, since the stored row decides the rest', () => {
    const schema = setupValueSchema(integrationSetupSchema.parse(inverter()).transport, 'partial');

    expect(schema.parse({ unitId: 3 })).toEqual({ unitId: 3 });
  });

  it('refuses a condition on a field that is later, missing, not a choice, or cannot hold it', () => {
    /**
     * The inverter with its password waiting on something else.
     *
     * @param shownWhen - What the password waits for.
     * @returns The declaration.
     */
    const waitingOn = (shownWhen: unknown): Record<string, unknown> => {
      const declaration = inverter();
      const transport = declaration['transport'] as { fields: Record<string, unknown>[] };
      const password = transport.fields[3];

      if (password !== undefined) {
        password['shownWhen'] = shownWhen;
      }

      return declaration;
    };

    expect(() =>
      integrationSetupSchema.parse(waitingOn({ key: 'region', equals: ['eu'] })),
    ).toThrow(/region/u);
    expect(() => integrationSetupSchema.parse(waitingOn({ key: 'host', equals: ['x'] }))).toThrow(
      /neither a choice nor a switch/u,
    );
    expect(() =>
      integrationSetupSchema.parse(waitingOn({ key: 'connection', equals: ['serial'] })),
    ).toThrow(/does not offer/u);
    expect(() => integrationSetupSchema.parse(waitingOn({ key: 'unitId', equals: ['1'] }))).toThrow(
      /asked only sometimes|neither/u,
    );
  });
});

describe('secretKeysOf', () => {
  it('lists the fields whose values must never be stored or shown as typed', () => {
    expect(secretKeysOf(integrationSetupSchema.parse(printer()).transport)).toEqual(['password']);
    expect(secretKeysOf(everyKind().transport)).toEqual([]);
  });
});

describe('asksAnythingRequired', () => {
  it('is true when either group has a field the owner must answer', () => {
    expect(asksAnythingRequired(integrationSetupSchema.parse(printer()))).toBe(true);
    expect(
      asksAnythingRequired(
        integrationSetupSchema.parse({
          transport: { fields: [] },
          options: {
            fields: [{ key: 'account', type: 'text', label: 'Account', isRequired: true }],
          },
        }),
      ),
    ).toBe(true);
  });

  it('is false for a declaration of optional fields, constants, or nothing at all', () => {
    // What decides whether a vendor "needs setting up" before its devices can connect. A
    // constant is the bundle's answer, not the owner's, and an optional field can wait.
    expect(
      asksAnythingRequired(
        integrationSetupSchema.parse({
          transport: {
            constants: { region: 'eu' },
            fields: [{ key: 'label', type: 'text', label: 'Label' }],
          },
        }),
      ),
    ).toBe(false);
    expect(asksAnythingRequired(integrationSetupSchema.parse({ transport: {} }))).toBe(false);
  });
});

describe('polling', () => {
  /**
   * An inverter read every 30 s by default, never faster than every 5, with a warning below 10.
   *
   * @returns The declaration, as read off disk.
   */
  function inverter(): Record<string, unknown> {
    return {
      transport: { fields: [{ key: 'host', type: 'text', label: 'Address', isRequired: true }] },
      polling: { default: 30, min: 5, warnBelow: 10 },
    };
  }

  it('becomes an option the owner sets, with its bounds and its warning', () => {
    const setup = withPollingField(integrationSetupSchema.parse(inverter()));

    expect(setup.polling).toBeUndefined();
    expect(setup.options.fields).toEqual([
      expect.objectContaining({
        key: 'pollInterval',
        type: 'number',
        isRequired: true,
        isInteger: true,
        unit: 's',
        min: 5,
        max: 86_400,
        default: 30,
        warnBelow: 10,
      }),
    ]);
  });

  it('is filled with its default, and refuses 0 and anything below the minimum', () => {
    const options = withPollingField(integrationSetupSchema.parse(inverter())).options;
    const schema = setupValueSchema(options, 'complete');

    expect(schema.parse({})).toEqual({ pollInterval: 30 });
    expect(schema.safeParse({ pollInterval: 0 }).success).toBe(false);
    expect(schema.safeParse({ pollInterval: 4 }).success).toBe(false);
    expect(schema.safeParse({ pollInterval: 7.5 }).success).toBe(false);
  });

  it('leaves a declaration without polling as it is', () => {
    const setup = integrationSetupSchema.parse(printer());

    expect(withPollingField(setup)).toBe(setup);
  });

  it('refuses a minimum of 0, and a default outside the bounds', () => {
    expect(() =>
      integrationSetupSchema.parse({ ...inverter(), polling: { default: 30, min: 0 } }),
    ).toThrow();
    expect(() =>
      integrationSetupSchema.parse({ ...inverter(), polling: { default: 3, min: 5 } }),
    ).toThrow(/default/u);
  });

  it('refuses a bundle that also declares the interval itself', () => {
    expect(() =>
      integrationSetupSchema.parse({
        ...inverter(),
        options: { fields: [{ key: 'pollInterval', type: 'number', label: 'Every' }] },
      }),
    ).toThrow(/pollInterval/u);
  });

  it('reads the chosen interval in milliseconds', () => {
    expect(pollIntervalMsOf({ pollInterval: 30 })).toBe(30_000);
    expect(pollIntervalMsOf({})).toBeUndefined();
    expect(pollIntervalMsOf({ pollInterval: 0 })).toBeUndefined();
  });
});
